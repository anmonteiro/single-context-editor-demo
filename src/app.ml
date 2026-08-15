let () =
  Js.log (Editor_mode_mixed_override.Shared.describe ());
  Js.log Editor_mode_mixed_override.Override.value;
  Js.log (Editor_mode_reason_override.Reason_shared.describe ());
  Js.log (Editor_mode_reason_ppx_override.Reason_ppx_user.describe ());
  Js.log Editor_mode_narrowed_modules.Common.value;
  Js.log Editor_mode_narrowed_modules.Melange_extra.value;
  Js.log Editor_mode_conditional_deps.Dep_user.value;
  Js.log Editor_mode_demo_melange_only.Melange_only.value;
  Js.log Editor_mode_melange_file_only.Melange_file_only.value
