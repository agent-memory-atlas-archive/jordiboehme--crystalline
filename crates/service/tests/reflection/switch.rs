//! The switch: the policy PATCH, its refusals and the reflection state.

use crystalline_service::Scope;

use crate::fixture::fixture;

#[tokio::test]
async fn reflection_home_is_never_set_by_hand() {
    let fx = fixture(&[]).await;
    let err = fx
        .engine
        .set_manifest_policies(
            "eng",
            &[("reflection_home".into(), "https://kb.example.com".into())],
            &Scope::Unrestricted,
        )
        .await
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("filled in when Reflection is switched on"),
        "{err}"
    );
}
