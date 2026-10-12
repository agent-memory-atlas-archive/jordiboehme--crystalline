//! Removing a folder tree Crystalline owns (staging, base snapshot, conflict
//! copies) in a way that cannot fail on a link.
//!
//! The walk itself is [`crystalline_core::tree::remove_tree`], shared with
//! every other crate; this module only turns its failure into the
//! working-tree error the share and pull paths report, so a Windows 4395
//! still gets its own sentence.

use std::path::Path;

use crate::error::RemoteError;

/// Removes `path` and everything under it. A path that is not there is
/// success. A symlink, junction or redirected folder is removed as a link and
/// its target is never touched or walked. The first failure stops the
/// removal and names a path: on Windows the one it happened at, elsewhere
/// the folder that was asked for.
pub fn remove_tree(path: &Path) -> Result<(), RemoteError> {
    crystalline_core::tree::remove_tree(path)
        .map(|_| ())
        .map_err(|e| RemoteError::working_tree(e.path.display().to_string(), e.source))
}
