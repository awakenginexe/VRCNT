use vrct_lib::font_packs::{
    decide_font_download, font_download_action, FontDownloadAction, FontDownloadPolicy,
};

#[test]
fn ask_policy_prompts_without_blocking_a_missing_pack() {
    assert_eq!(
        font_download_action(FontDownloadPolicy::Ask, false, false),
        FontDownloadAction::Ask,
    );
    assert_eq!(
        font_download_action(FontDownloadPolicy::Ask, false, true),
        FontDownloadAction::Download,
    );
}

#[test]
fn automatic_policy_queues_only_missing_packs_and_never_keeps_fallback() {
    assert_eq!(
        font_download_action(FontDownloadPolicy::Automatic, false, false),
        FontDownloadAction::Download,
    );
    assert_eq!(
        font_download_action(FontDownloadPolicy::Never, false, false),
        FontDownloadAction::Fallback,
    );
    assert_eq!(
        font_download_action(FontDownloadPolicy::Automatic, true, false),
        FontDownloadAction::Available,
    );
    assert_eq!(
        decide_font_download(FontDownloadPolicy::Automatic, true),
        FontDownloadPolicy::Never,
    );
}
