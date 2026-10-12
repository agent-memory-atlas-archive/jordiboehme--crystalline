//! Removing a folder tree Crystalline owns (staging, base snapshot, conflict
//! copies) in a way that cannot fail on a link.
//!
//! `std::fs::remove_dir_all` opens children without following reparse points
//! and, on Windows, answers error 4395 for a junction or a redirected folder
//! it meets. These folders live under the state directory, which a user may
//! have redirected, so [`remove_tree`] deletes a link as the link itself and
//! only walks real folders, and a failure names the path it stopped at.

use std::path::Path;

use crate::error::RemoteError;

/// Removes `path` and everything under it. A path that is not there is
/// success. A symlink, junction or redirected folder is removed as a link and
/// its target is never touched or walked. The first failure stops the
/// removal and names the path it happened at.
pub fn remove_tree(path: &Path) -> Result<(), RemoteError> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(named(path, e)),
    };
    if is_link(&meta) {
        return remove_link(path, &meta);
    }
    if !meta.is_dir() {
        return remove_ignoring_missing(std::fs::remove_file(path), path);
    }
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(named(path, e)),
    };
    for entry in entries {
        let entry = entry.map_err(|e| named(path, e))?;
        remove_tree(&entry.path())?;
    }
    remove_ignoring_missing(std::fs::remove_dir(path), path)
}

fn named(path: &Path, source: std::io::Error) -> RemoteError {
    RemoteError::working_tree(path.display().to_string(), source)
}

fn remove_ignoring_missing(result: std::io::Result<()>, path: &Path) -> Result<(), RemoteError> {
    match result {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
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
fn remove_link(path: &Path, meta: &std::fs::Metadata) -> Result<(), RemoteError> {
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
        remove_tree(&dir.path().join("nope")).unwrap();
    }

    #[test]
    fn a_tree_is_removed_with_its_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("t");
        std::fs::create_dir_all(root.join("a/b")).unwrap();
        std::fs::write(root.join("a/b/f.md"), b"x").unwrap();
        remove_tree(&root).unwrap();
        assert!(!root.exists());
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
}
