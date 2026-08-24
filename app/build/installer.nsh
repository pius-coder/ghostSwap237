; electron-builder NSIS hooks. The package is per-machine and always elevated.

!macro customInstall
  IfFileExists "$INSTDIR\resources\henshin-cam\henshin_cam_registrar.exe" henshin_install_camera henshin_install_missing

  henshin_install_camera:
    nsExec::ExecToLog '"$INSTDIR\resources\henshin-cam\henshin_cam_registrar.exe" install --all-users'
    Pop $0
    StrCmp $0 "0" henshin_install_done henshin_install_failed

  henshin_install_missing:
    MessageBox MB_OK|MB_ICONSTOP "The Henshin camera registrar is missing. Installation cannot continue."
    Abort

  henshin_install_failed:
    MessageBox MB_OK|MB_ICONSTOP "Machine-wide Henshin camera registration failed (exit code $0). Installation cannot continue."
    Abort

  henshin_install_done:
!macroend

!macro customUnInstall
  IfFileExists "$INSTDIR\resources\henshin-cam\henshin_cam_registrar.exe" henshin_uninstall_camera henshin_uninstall_missing

  henshin_uninstall_camera:
    nsExec::ExecToLog '"$INSTDIR\resources\henshin-cam\henshin_cam_registrar.exe" remove --all-users --unregister-com'
    Pop $0
    StrCmp $0 "0" henshin_uninstall_cleanup henshin_uninstall_failed

  henshin_uninstall_missing:
    MessageBox MB_OK|MB_ICONSTOP "The Henshin camera registrar is missing. Camera deregistration cannot continue."
    Abort

  henshin_uninstall_failed:
    MessageBox MB_OK|MB_ICONSTOP "Henshin camera deregistration failed (exit code $0). Uninstallation has stopped so it can be retried."
    Abort

  henshin_uninstall_cleanup:
    ; Delete only directories exclusively owned by the camera runtime.
    ReadEnvStr $2 "ProgramData"
    StrCmp $2 "" henshin_uninstall_public
    RMDir /r "$2\HenshinCam"

  henshin_uninstall_public:
    ReadEnvStr $1 "PUBLIC"
    StrCmp $1 "" henshin_uninstall_done
    RMDir /r "$1\Documents\HenshinCam"

  henshin_uninstall_done:
!macroend
