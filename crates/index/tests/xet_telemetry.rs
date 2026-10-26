//! The Xet client's download telemetry stays off.
//!
//! hf-xet 1.7.0 reports every transfer to the Xet storage server by default.
//! hf-hub builds its Xet session from `XetConfig::new()` and takes no
//! configuration from us, so `keep_xet_telemetry_off` works through the
//! environment, and this test resolves the configuration the same way hf-hub
//! does after it ran.
//!
//! A test binary of its own with exactly one test: it writes the process
//! environment, which is only sound while no other thread reads it, and the
//! shared `it` binary runs many tests on parallel threads.
#![cfg(feature = "local-embeddings")]

use crystalline_index::{XET_TELEMETRY_ENV, keep_xet_telemetry_off};
use xet::xet_session::XetConfig;

#[test]
fn the_xet_client_reports_no_telemetry_even_when_the_environment_asks_for_it() {
    let (name, _) = XET_TELEMETRY_ENV;
    // SAFETY: the only test in this binary, so no other thread reads or writes
    // the environment while it runs.
    unsafe {
        // hf-xet's own opt-outs (xet-runtime's `TELEMETRY_OPT_OUT_VARS`) would
        // turn the reports off on their own and hide whether ours works.
        for opt_out in [
            "HF_HUB_DISABLE_TELEMETRY",
            "DISABLE_TELEMETRY",
            "DO_NOT_TRACK",
            "HF_HUB_OFFLINE",
            "TRANSFORMERS_OFFLINE",
        ] {
            std::env::remove_var(opt_out);
        }
        std::env::set_var(name, "true");
    }
    assert!(
        XetConfig::new().telemetry.enabled,
        "the precondition: {name}=true turns the reports on"
    );

    // SAFETY: as above.
    unsafe { keep_xet_telemetry_off() };

    assert!(
        !XetConfig::new().telemetry.enabled,
        "hf-hub's session config must have telemetry off"
    );
}
