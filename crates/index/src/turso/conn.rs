//! The store's connection, with one retry for a refused temp directory.
//!
//! The embedded engine answers many ordinary statements with an ephemeral
//! table: an `IN (...)` list or subquery, a `RETURNING` clause, a correlated
//! subquery, a `DISTINCT`. With the default temp store it backs each one with a
//! fresh directory plus file under the process temp location, created eagerly
//! by `tempfile::tempdir()` when the table is opened, even when it stays empty
//! (`TempFile::new` in turso_core's `io/mod.rs`). On Windows that create is
//! refused now and then with "permission denied", and the statement fails with
//! `I/O error (tempdir): permission denied` although nothing is wrong with the
//! database or the statement. The runtime keeps the default temp store on
//! purpose (a sorter that outgrows its buffer must spill to disk, see
//! `research/2026-07-28-turso-sorter-spill.md`), so the statement is retried
//! instead, once, and only on exactly that error.
//!
//! A retry is only sound when the failed attempt left nothing behind, and what
//! it leaves depends on where it ran (turso_core 0.8.1, `Program::abort` in
//! `vdbe/mod.rs`):
//!
//! - In autocommit mode the statement was its own transaction and the engine
//!   rolled it back, so the statement runs again.
//! - Inside an explicit transaction that is still open, the statement had a
//!   statement savepoint and only the statement was undone, so it runs again.
//! - Inside an explicit transaction that is gone, the engine rolled back the
//!   whole transaction (a read, or a write without a statement savepoint, takes
//!   that path). The statement alone cannot run again: the writes before it
//!   are lost. So the connection keeps a journal of every statement since the
//!   `BEGIN`, opens the transaction again, replays the journal and then runs
//!   the statement. The replay starts from the state the first `BEGIN` saw,
//!   because the store is the only writer and its callers hold it for the
//!   whole transaction, so every replayed statement does what it did the first
//!   time. A journal that grows past [`JOURNAL_CAP`] is dropped, and a failure
//!   there is not retried.
//!
//! A second failure is returned as it is. After a replay that failed, no
//! explicit transaction is left open, which is where the caller would have
//! been without the retry.

use std::sync::Mutex;

use turso::params::{IntoParams, Params};
use turso::{Connection, Row, Value};

/// The most parameter bytes a transaction's journal holds before it is
/// dropped. A full reindex runs in one transaction and carries every body as a
/// parameter; past this size a replay is not worth the memory.
const JOURNAL_CAP: usize = 64 << 20;

/// The store's connection: the engine's connection plus the retry.
pub(crate) struct Conn {
    conn: Connection,
    journal: Mutex<Journal>,
}

/// What the connection knows about the explicit transaction it is in.
enum Journal {
    /// Autocommit mode.
    Idle,
    /// Inside an explicit transaction, with every statement since `begin`.
    Open {
        begin: String,
        entries: Vec<Entry>,
        bytes: usize,
    },
    /// Inside an explicit transaction whose journal outgrew [`JOURNAL_CAP`].
    TooLarge,
}

/// One statement of a journal, run again the way it ran the first time.
struct Entry {
    shape: Shape,
    sql: String,
    params: Params,
}

/// How a statement is run: through `execute`, or as a query drained to the end.
#[derive(Clone, Copy)]
enum Shape {
    Execute,
    Query,
}

/// What one run of a statement returned.
enum Outcome {
    Changes(u64),
    Rows(Vec<Row>),
}

/// A statement runner: the store's [`Conn`], or the engine's own connection in
/// a migration, which runs with its temp store in memory and needs no retry.
pub(crate) trait Execute {
    async fn execute(&self, sql: &str, params: Vec<Value>) -> turso::Result<u64>;
}

impl Execute for Conn {
    async fn execute(&self, sql: &str, params: Vec<Value>) -> turso::Result<u64> {
        Conn::execute(self, sql, params).await
    }
}

impl Execute for Connection {
    async fn execute(&self, sql: &str, params: Vec<Value>) -> turso::Result<u64> {
        Connection::execute(self, sql, params).await
    }
}

/// Whether `err` is the engine failing to create the directory for an
/// ephemeral table, which is the only error this connection retries.
pub(crate) fn is_tempdir_refusal(err: &turso::Error) -> bool {
    matches!(
        err,
        turso::Error::IoError(std::io::ErrorKind::PermissionDenied, "tempdir")
    )
}

impl Conn {
    /// Wrap an open connection, which must be in autocommit mode.
    pub(crate) fn new(conn: Connection) -> Conn {
        Conn {
            conn,
            journal: Mutex::new(Journal::Idle),
        }
    }

    /// The engine's connection, for the callers that need it directly: the
    /// migrations, and a prepared statement reused across reads. Nothing that
    /// writes may run on it inside a transaction, or a replay would miss it.
    pub(crate) fn raw(&self) -> &Connection {
        &self.conn
    }

    /// The rowid of the last row this connection inserted.
    pub(crate) fn last_insert_rowid(&self) -> i64 {
        self.conn.last_insert_rowid()
    }

    /// Run a statement that returns no rows, as `Connection::execute` does.
    pub(crate) async fn execute(&self, sql: &str, params: impl IntoParams) -> turso::Result<u64> {
        let params = params.into_params()?;
        match self.run(Shape::Execute, sql, params).await? {
            Outcome::Changes(n) => Ok(n),
            Outcome::Rows(_) => Ok(0),
        }
    }

    /// Run a query and drain it to the end, every row kept.
    pub(crate) async fn query_all(&self, sql: &str, params: Vec<Value>) -> turso::Result<Vec<Row>> {
        match self
            .run(Shape::Query, sql, Params::Positional(params))
            .await?
        {
            Outcome::Rows(rows) => Ok(rows),
            Outcome::Changes(_) => Ok(Vec::new()),
        }
    }

    async fn run(&self, shape: Shape, sql: &str, params: Params) -> turso::Result<Outcome> {
        let was_autocommit = self.conn.is_autocommit()?;
        let err = match self.once(shape, sql, params.clone()).await {
            Ok(outcome) => {
                self.record(shape, sql, params, was_autocommit)?;
                return Ok(outcome);
            }
            Err(err) if is_tempdir_refusal(&err) => err,
            Err(err) => {
                self.forget_if_closed();
                return Err(err);
            }
        };
        let replayed = !was_autocommit && self.conn.is_autocommit()?;
        #[cfg(test)]
        hook::before_retry(replayed);
        if replayed {
            tracing::warn!(
                statement = sql,
                "the engine could not create a temp directory and dropped the transaction; \
                 replaying it"
            );
            self.replay(err).await?;
        } else {
            tracing::warn!(
                statement = sql,
                "the engine could not create a temp directory; running the statement again"
            );
        }
        match self.once(shape, sql, params.clone()).await {
            Ok(outcome) => {
                self.record(shape, sql, params, was_autocommit)?;
                Ok(outcome)
            }
            Err(err) if replayed => {
                self.abandon().await;
                Err(err)
            }
            Err(err) => {
                self.forget_if_closed();
                Err(err)
            }
        }
    }

    /// One run of a statement, drained to the end.
    async fn once(&self, shape: Shape, sql: &str, params: Params) -> turso::Result<Outcome> {
        match shape {
            Shape::Execute => self.conn.execute(sql, params).await.map(Outcome::Changes),
            Shape::Query => {
                let mut rows = self.conn.query(sql, params).await?;
                let mut out = Vec::new();
                while let Some(row) = rows.next().await? {
                    out.push(row);
                }
                Ok(Outcome::Rows(out))
            }
        }
    }

    /// Open the dropped transaction again and run every statement it had run.
    /// When that cannot be done, `err` (the refusal that dropped it) is
    /// returned and no transaction is left open.
    async fn replay(&self, err: turso::Error) -> turso::Result<()> {
        let journal = std::mem::replace(&mut *self.lock(), Journal::Idle);
        let Journal::Open { begin, entries, .. } = journal else {
            return Err(err);
        };
        self.conn.execute(&begin, ()).await?;
        for entry in &entries {
            if let Err(e) = self
                .once(entry.shape, &entry.sql, entry.params.clone())
                .await
            {
                self.abandon().await;
                return Err(e);
            }
        }
        let bytes = entries
            .iter()
            .map(|e| e.sql.len() + params_bytes(&e.params))
            .sum();
        *self.lock() = Journal::Open {
            begin,
            entries,
            bytes,
        };
        Ok(())
    }

    /// Bring the journal in line with the connection after a statement ran:
    /// a statement that left autocommit mode opened a transaction and starts a
    /// journal, one inside a transaction joins it, and one that ended in
    /// autocommit mode leaves none.
    fn record(
        &self,
        shape: Shape,
        sql: &str,
        params: Params,
        was_autocommit: bool,
    ) -> turso::Result<()> {
        let autocommit = self.conn.is_autocommit()?;
        let mut journal = self.lock();
        if autocommit {
            *journal = Journal::Idle;
        } else if was_autocommit {
            *journal = Journal::Open {
                begin: sql.to_string(),
                entries: Vec::new(),
                bytes: 0,
            };
        } else if let Journal::Open { entries, bytes, .. } = &mut *journal {
            *bytes += sql.len() + params_bytes(&params);
            if *bytes > JOURNAL_CAP {
                *journal = Journal::TooLarge;
            } else {
                entries.push(Entry {
                    shape,
                    sql: sql.to_string(),
                    params,
                });
            }
        }
        Ok(())
    }

    /// Drop the journal when a failed statement ended the transaction.
    fn forget_if_closed(&self) {
        if self.conn.is_autocommit().unwrap_or(true) {
            *self.lock() = Journal::Idle;
        }
    }

    /// Leave no explicit transaction open after a retry that failed, so the
    /// caller sees what it would have seen without the retry: the transaction
    /// gone and its own `ROLLBACK` refused or a no-op.
    async fn abandon(&self) {
        if !self.conn.is_autocommit().unwrap_or(true) {
            let _ = self.conn.execute("ROLLBACK", ()).await;
        }
        *self.lock() = Journal::Idle;
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Journal> {
        self.journal.lock().unwrap_or_else(|p| p.into_inner())
    }
}

/// Roughly how many bytes a statement's parameters hold.
fn params_bytes(params: &Params) -> usize {
    fn value(v: &Value) -> usize {
        match v {
            Value::Text(s) => s.len(),
            Value::Blob(b) => b.len(),
            _ => 8,
        }
    }
    match params {
        Params::None => 0,
        Params::Positional(values) => values.iter().map(value).sum(),
        Params::Named(values) => values.iter().map(|(k, v)| k.len() + value(v)).sum(),
    }
}

#[cfg(test)]
mod hook {
    use std::sync::Mutex;

    type Hook = Box<dyn Fn(bool) + Send>;

    /// Run in [`super::Conn::run`] between a refused attempt and its retry,
    /// told whether the transaction is replayed, so a test can see which way
    /// the retry went and make the temp location usable again exactly there.
    static BEFORE_RETRY: Mutex<Option<Hook>> = Mutex::new(None);

    pub(super) fn before_retry(replayed: bool) {
        if let Some(hook) = BEFORE_RETRY.lock().unwrap().as_ref() {
            hook(replayed);
        }
    }

    pub(super) fn set_before_retry(hook: impl Fn(bool) + Send + 'static) {
        *BEFORE_RETRY.lock().unwrap() = Some(Box::new(hook));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::sync::{Arc, Mutex};

    use turso::{Builder, Value};

    use super::{Conn, hook, is_tempdir_refusal};
    use crate::store::{DomainKind, Store};

    /// Set in the child run of
    /// [`a_refused_temp_directory_is_retried_once_and_leaves_no_trace`],
    /// holding the folder the child's temp location points at.
    const CHILD: &str = "CRYSTALLINE_TEST_TEMPDIR_REFUSED";

    fn lock(dir: &Path) {
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    }

    fn unlock(dir: &Path) {
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    }

    /// Every retry the hook saw, as "was the transaction replayed".
    type Seen = Arc<Mutex<Vec<bool>>>;

    /// A hook that records each retry and, when `heal`, unlocks `dir` so the
    /// retry finds a usable temp location.
    fn watch(dir: PathBuf, heal: Arc<Mutex<bool>>) -> Seen {
        let seen: Seen = Arc::default();
        let log = seen.clone();
        hook::set_before_retry(move |replayed| {
            log.lock().unwrap().push(replayed);
            if *heal.lock().unwrap() {
                unlock(&dir);
            }
        });
        seen
    }

    fn take(seen: &Seen) -> Vec<bool> {
        std::mem::take(&mut *seen.lock().unwrap())
    }

    async fn texts(conn: &Conn, sql: &str) -> Vec<String> {
        conn.query_all(sql, vec![])
            .await
            .unwrap()
            .iter()
            .map(|r| match r.get_value(0).unwrap() {
                Value::Text(t) => t,
                other => format!("{other:?}"),
            })
            .collect()
    }

    /// The scenarios, run in the child where the temp location is a folder
    /// this test can lock (no directory can be created in it) and unlock.
    async fn child(dir: PathBuf) {
        let heal = Arc::new(Mutex::new(true));
        let seen = watch(dir.clone(), heal.clone());
        let db = Builder::new_local(":memory:").build().await.unwrap();
        let conn = Conn::new(db.connect().unwrap());
        conn.execute(
            "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)",
            (),
        )
        .await
        .unwrap();
        conn.execute("CREATE TABLE u (id INTEGER PRIMARY KEY)", ())
            .await
            .unwrap();
        conn.execute(
            "INSERT INTO t(id, v) VALUES (1, 'one'), (2, 'two'), (3, 'three')",
            (),
        )
        .await
        .unwrap();
        conn.execute("INSERT INTO u(id) VALUES (1), (3)", ())
            .await
            .unwrap();
        // An `IN (SELECT ...)` is answered with an ephemeral table.
        let pick = "SELECT v FROM t WHERE id IN (SELECT id FROM u) ORDER BY id";

        // A read in autocommit mode runs again.
        lock(&dir);
        assert_eq!(texts(&conn, pick).await, ["one", "three"]);
        assert_eq!(take(&seen), [false], "one retry, no replay");

        // A write in autocommit mode was rolled back and runs again, once.
        lock(&dir);
        let changed = conn
            .execute(
                "UPDATE t SET v = v || '!' WHERE id IN (SELECT id FROM u)",
                (),
            )
            .await
            .unwrap();
        assert_eq!(changed, 2);
        assert_eq!(take(&seen), [false]);
        assert_eq!(
            texts(&conn, "SELECT v FROM t ORDER BY id").await,
            ["one!", "two", "three!"],
            "the update applied exactly once"
        );

        // A read inside a transaction makes the engine drop the transaction,
        // so the transaction is replayed: the insert before the read is kept
        // and the one after it lands in the same transaction.
        conn.execute("BEGIN", ()).await.unwrap();
        conn.execute("INSERT INTO t(id, v) VALUES (4, 'four')", ())
            .await
            .unwrap();
        conn.execute("INSERT INTO u(id) VALUES (4)", ())
            .await
            .unwrap();
        lock(&dir);
        assert_eq!(
            texts(&conn, pick).await,
            ["one!", "three!", "four"],
            "the replayed transaction is the one the read sees"
        );
        assert_eq!(take(&seen), [true], "the transaction was replayed");
        conn.execute("INSERT INTO t(id, v) VALUES (5, 'five')", ())
            .await
            .unwrap();
        assert!(
            !conn.raw().is_autocommit().unwrap(),
            "still in the transaction"
        );
        conn.execute("COMMIT", ()).await.unwrap();
        assert_eq!(
            texts(&conn, "SELECT v FROM t ORDER BY id").await,
            ["one!", "two", "three!", "four", "five"]
        );

        // A write with a statement savepoint inside a transaction: the engine
        // undid only the statement and kept the transaction, so the statement
        // runs again and the transaction's earlier write is kept.
        conn.execute("BEGIN", ()).await.unwrap();
        conn.execute("INSERT INTO u(id) VALUES (2)", ())
            .await
            .unwrap();
        lock(&dir);
        let changed = conn
            .execute(
                "UPDATE t SET v = v || '?' WHERE id IN (SELECT id FROM u)",
                (),
            )
            .await
            .unwrap();
        assert_eq!(changed, 4);
        assert_eq!(take(&seen), [false], "only the statement was undone");
        conn.execute("COMMIT", ()).await.unwrap();
        assert_eq!(
            texts(&conn, "SELECT v FROM t ORDER BY id").await,
            ["one!?", "two?", "three!?", "four?", "five"]
        );

        // A rolled back replay leaves nothing behind either.
        conn.execute("BEGIN", ()).await.unwrap();
        conn.execute("INSERT INTO t(id, v) VALUES (6, 'six')", ())
            .await
            .unwrap();
        lock(&dir);
        assert_eq!(texts(&conn, pick).await.len(), 4);
        assert_eq!(take(&seen), [true]);
        conn.execute("ROLLBACK", ()).await.unwrap();
        assert_eq!(
            texts(&conn, "SELECT v FROM t WHERE id = 6").await,
            Vec::<String>::new()
        );

        // A refusal that does not go away is returned after one retry, and a
        // transaction it dropped stays dropped.
        *heal.lock().unwrap() = false;
        lock(&dir);
        let err = conn.query_all(pick, vec![]).await.unwrap_err();
        assert!(is_tempdir_refusal(&err), "{err}");
        assert_eq!(take(&seen), [false]);
        conn.execute("BEGIN", ()).await.unwrap();
        conn.execute("INSERT INTO t(id, v) VALUES (7, 'seven')", ())
            .await
            .unwrap();
        let err = conn.query_all(pick, vec![]).await.unwrap_err();
        assert!(is_tempdir_refusal(&err), "{err}");
        assert_eq!(take(&seen), [true]);
        assert!(
            conn.raw().is_autocommit().unwrap(),
            "no transaction left open"
        );
        unlock(&dir);
        *heal.lock().unwrap() = true;
        assert_eq!(
            texts(&conn, "SELECT v FROM t WHERE id = 7").await,
            Vec::<String>::new()
        );

        // Through the store: the domain listing reads with subqueries the
        // engine answers with ephemeral tables.
        let store = crate::turso::TursoStore::open_in_memory().await.unwrap();
        store
            .upsert_domain("notes", None, DomainKind::Virtual)
            .await
            .unwrap();
        lock(&dir);
        let stats = store.domain_stats().await.unwrap();
        assert_eq!(stats.len(), 1);
        assert_eq!(take(&seen), [false]);
        unlock(&dir);
    }

    /// A statement whose ephemeral table cannot get its temp directory is run
    /// again once, and what it leaves behind is what a clean run leaves.
    ///
    /// On Windows the engine's create of that directory is refused now and
    /// then with "permission denied" (see the module doc). A folder with no
    /// write permission refuses it the same way, every time, on unix; this
    /// runs the scenarios in a child process whose temp location is such a
    /// folder, and a hook unlocks it between the refused attempt and the
    /// retry. The environment can only be changed for a whole process, hence
    /// the child.
    #[tokio::test]
    async fn a_refused_temp_directory_is_retried_once_and_leaves_no_trace() {
        if let Some(dir) = std::env::var_os(CHILD) {
            child(PathBuf::from(dir)).await;
            return;
        }
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("temp");
        std::fs::create_dir(&dir).unwrap();
        lock(&dir);
        if std::fs::create_dir(dir.join("probe")).is_ok() {
            // Root ignores the permission bits, so nothing can be refused.
            unlock(&dir);
            eprintln!("skipped: a folder without write permission accepts a create here");
            return;
        }
        unlock(&dir);
        let out = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "turso::conn::tests::a_refused_temp_directory_is_retried_once_and_leaves_no_trace",
                "--exact",
                "--test-threads=1",
                "--nocapture",
            ])
            .env(CHILD, &dir)
            .env("TMPDIR", &dir)
            .env_remove("TURSO_TMPDIR")
            .env_remove("SQLITE_TMPDIR")
            .output()
            .unwrap();
        unlock(&dir);
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(
            out.status.success(),
            "the child failed:\n{stdout}\n{stderr}"
        );
        assert!(
            stdout.contains("1 passed"),
            "the child ran the test rather than filtering it out:\n{stdout}"
        );
    }
}
