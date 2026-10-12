//! Removing a folder tree Crystalline owns (state folders, staging folders,
//! the model cache) in a way that cannot fail on a link.
//!
//! `std::fs::remove_dir_all` opens children without following reparse points
//! and, on Windows, answers error 4395 for a junction or a redirected folder
//! it meets. These folders live under the state directory, which a user may
//! have redirected, so [`remove_tree`] deletes a link as the link itself and
//! only walks real folders, and a failure names the path it stopped at.
//!
//! Only `std` is used, so every crate can call it.

use std::fmt;
use std::io;
use std::path::{Path, PathBuf};

/// A failed [`remove_tree`]: the path it stopped at and the untouched
/// operating system error, so a caller can still read its raw code.
#[derive(Debug)]
pub struct RemoveTreeError {
    /// The file, folder or link that could not be read or removed.
    pub path: PathBuf,
    /// The error the file system answered, as it came.
    pub source: io::Error,
}

impl fmt::Display for RemoveTreeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.path.display(), self.source)
    }
}

impl std::error::Error for RemoveTreeError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.source)
    }
}

impl From<RemoveTreeError> for io::Error {
    /// Keeps the error kind and puts the path into the message. The raw
    /// operating system code is only on [`RemoveTreeError::source`].
    fn from(e: RemoveTreeError) -> Self {
        io::Error::new(e.source.kind(), e)
    }
}

/// Removes `path` and everything under it. Answers whether there was
/// anything to remove: a path that is not there is success with `false`. A
/// symlink, junction or redirected folder is removed as a link and its target
/// is never touched or walked. The first failure stops the removal and names
/// a path: on Windows the one it happened at, on unix the folder that std's
/// own walk was removing.
pub fn remove_tree(path: &Path) -> Result<bool, RemoveTreeError> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(named(path, e)),
    };
    remove_present(path, &meta)
}

/// Removes what is at `path`, described by `meta`. Answers whether it was
/// still there.
fn remove_present(path: &Path, meta: &std::fs::Metadata) -> Result<bool, RemoveTreeError> {
    if is_link(meta) {
        remove_link(path, meta)?;
        return Ok(true);
    }
    if !meta.is_dir() {
        remove_regular_file(path)?;
        return Ok(true);
    }
    remove_real_folder(path)
}

/// A real folder on unix goes with std: its walk uses `openat` and `unlinkat`
/// with `O_NOFOLLOW`, so a link inside is removed as a link, never followed,
/// and a folder swapped for a link during the walk is not entered either.
#[cfg(unix)]
fn remove_real_folder(path: &Path) -> Result<bool, RemoveTreeError> {
    match std::fs::remove_dir_all(path) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(named(path, e)),
    }
}

/// A real folder elsewhere is walked by hand: std's walk on Windows answers
/// error 4395 for a junction or a redirected folder inside.
#[cfg(not(unix))]
fn remove_real_folder(path: &Path) -> Result<bool, RemoveTreeError> {
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(named(path, e)),
    };
    for entry in entries {
        let entry = entry.map_err(|e| named(path, e))?;
        remove_tree(&entry.path())?;
    }
    remove_ignoring_missing(std::fs::remove_dir(path), path)?;
    Ok(true)
}

/// Removes a file that is not a link.
#[cfg(not(windows))]
fn remove_regular_file(path: &Path) -> Result<(), RemoveTreeError> {
    remove_ignoring_missing(std::fs::remove_file(path), path)
}

/// Removes a file that is not a link. Windows refuses to delete a read-only
/// file, where std's own folder removal ignores the attribute, so a refused
/// file loses the attribute and is tried once more. Never called for a link:
/// clearing the attribute through a link would change its target.
#[cfg(windows)]
fn remove_regular_file(path: &Path) -> Result<(), RemoveTreeError> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
            let meta = std::fs::symlink_metadata(path).map_err(|e| named(path, e))?;
            if is_link(&meta) || !meta.permissions().readonly() {
                return Err(named(path, e));
            }
            let mut writable = meta.permissions();
            // Windows only: there this clears FILE_ATTRIBUTE_READONLY and
            // nothing else, unlike the unix mode bits the lint warns about.
            #[allow(clippy::permissions_set_readonly_false)]
            writable.set_readonly(false);
            std::fs::set_permissions(path, writable).map_err(|e| named(path, e))?;
            remove_ignoring_missing(std::fs::remove_file(path), path)
        }
        result => remove_ignoring_missing(result, path),
    }
}

fn named(path: &Path, source: io::Error) -> RemoveTreeError {
    RemoveTreeError {
        path: path.to_path_buf(),
        source,
    }
}

fn remove_ignoring_missing(result: io::Result<()>, path: &Path) -> Result<(), RemoveTreeError> {
    match result {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(named(path, e)),
    }
}

/// Whether the entry is a link: a symlink, and on Windows also a junction.
/// std reports a junction (a name-surrogate reparse point) as a symlink, so
/// one check covers both. A reparse point that is not a name surrogate, such
/// as a cloud placeholder folder, is an ordinary folder and is walked.
fn is_link(meta: &std::fs::Metadata) -> bool {
    meta.file_type().is_symlink()
}

/// Whether the link is a folder link (a junction or a folder symlink), which
/// Windows removes with `remove_dir`; a file link goes with `remove_file`.
#[cfg(windows)]
fn is_folder_link(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
    meta.file_attributes() & FILE_ATTRIBUTE_DIRECTORY != 0
}

#[cfg(not(windows))]
fn is_folder_link(_meta: &std::fs::Metadata) -> bool {
    false
}

/// Deletes the link itself and never looks inside it. If the removal fails the
/// error names the link: walking into it would delete the files of whatever
/// it points at, which Crystalline does not own.
fn remove_link(path: &Path, meta: &std::fs::Metadata) -> Result<(), RemoveTreeError> {
    if is_folder_link(meta) {
        return remove_ignoring_missing(std::fs::remove_dir(path), path);
    }
    remove_ignoring_missing(std::fs::remove_file(path), path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_path_is_removed_already() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!remove_tree(&dir.path().join("nope")).unwrap());
    }

    #[test]
    fn a_tree_is_removed_with_its_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("t");
        std::fs::create_dir_all(root.join("a/b")).unwrap();
        std::fs::write(root.join("a/b/f.md"), b"x").unwrap();
        assert!(remove_tree(&root).unwrap());
        assert!(!root.exists());
    }

    #[test]
    fn a_single_file_is_removed() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f.md");
        std::fs::write(&file, b"x").unwrap();
        assert!(remove_tree(&file).unwrap());
        assert!(!file.exists());
    }

    #[test]
    fn the_io_error_keeps_the_kind_and_names_the_path() {
        let e = RemoveTreeError {
            path: PathBuf::from("state/overlays"),
            source: io::Error::from(io::ErrorKind::PermissionDenied),
        };
        let io: io::Error = e.into();
        assert_eq!(io.kind(), io::ErrorKind::PermissionDenied);
        assert!(io.to_string().contains("overlays"), "{io}");
    }

    #[cfg(unix)]
    #[test]
    fn a_link_inside_is_removed_as_a_link_and_its_target_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("keep.md"), b"keep").unwrap();
        let root = dir.path().join("t");
        std::fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("linked")).unwrap();
        remove_tree(&root).unwrap();
        assert!(!root.exists());
        assert!(outside.path().join("keep.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_is_itself_a_link_is_removed_as_a_link() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("keep.md"), b"keep").unwrap();
        let root = dir.path().join("t");
        std::os::unix::fs::symlink(outside.path(), &root).unwrap();
        assert!(remove_tree(&root).unwrap());
        assert!(std::fs::symlink_metadata(&root).is_err());
        assert!(outside.path().join("keep.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_dangling_link_is_removed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("t");
        std::os::unix::fs::symlink(dir.path().join("gone"), &root).unwrap();
        assert!(remove_tree(&root).unwrap());
        assert!(std::fs::symlink_metadata(&root).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn a_staging_folder_with_a_junction_inside_is_removed_and_the_target_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("keep.md"), b"keep").unwrap();
        let root = dir.path().join("t");
        std::fs::create_dir_all(&root).unwrap();
        let out = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(root.join("linked"))
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(out.status.success(), "mklink failed");
        remove_tree(&root).unwrap();
        assert!(!root.exists());
        assert!(outside.path().join("keep.md").exists());
    }

    #[cfg(windows)]
    #[test]
    fn a_staging_folder_that_is_itself_a_junction_is_removed_as_a_link() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("keep.md"), b"keep").unwrap();
        let root = dir.path().join("t");
        let out = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&root)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(out.status.success(), "mklink failed");
        remove_tree(&root).unwrap();
        assert!(!root.exists());
        assert!(outside.path().join("keep.md").exists());
    }

    #[cfg(windows)]
    #[test]
    fn a_folder_with_a_read_only_file_inside_is_removed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("t");
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("locked.md");
        std::fs::write(&file, b"x").unwrap();
        let mut perms = std::fs::metadata(&file).unwrap().permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&file, perms).unwrap();
        assert!(remove_tree(&root).unwrap());
        assert!(!root.exists());
    }

    #[cfg(windows)]
    #[test]
    fn a_dangling_junction_is_removed_as_a_link() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        let root = dir.path().join("t");
        let out = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&root)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(out.status.success(), "mklink failed");
        std::fs::remove_dir(&outside).unwrap();
        assert!(remove_tree(&root).unwrap());
        assert!(std::fs::symlink_metadata(&root).is_err());
    }
}
