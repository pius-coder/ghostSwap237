; electron-builder NSIS hooks. The package is per-machine and always elevated.
!include "WinVer.nsh"

!macro customInstall
  ${If} ${AtLeastBuild} 22000
    IfFileExists "$INSTDIR\resources\henshin-cam\henshin-vcam-register.exe" henshin_install_camera henshin_install_missing

    henshin_install_camera:
      nsExec::ExecToLog '"$INSTDIR\resources\henshin-cam\henshin-vcam-register.exe" install --dll "$INSTDIR\resources\henshin-cam\henshin-vcam.dll"'
      Pop $0
      StrCmp $0 "0" henshin_install_done henshin_install_failed

    henshin_install_missing:
      MessageBox MB_OK|MB_ICONSTOP "The Henshin camera registrar is missing. Installation cannot continue."
      Abort

    henshin_install_failed:
      MessageBox MB_OK|MB_ICONSTOP "Machine-wide Henshin camera registration failed (exit code $0). Installation cannot continue."
      Abort
  ${Else}
    MessageBox MB_OK|MB_ICONSTOP "Henshin requires Windows 11 (build 22000 or later). Windows 10 is no longer supported."
    Abort
  ${EndIf}

  henshin_install_done:
!macroend

!macro customUnInstall
  ${If} ${AtLeastBuild} 22000
    IfFileExists "$INSTDIR\resources\henshin-cam\henshin-vcam-register.exe" henshin_uninstall_camera henshin_uninstall_missing

    henshin_uninstall_camera:
      nsExec::ExecToLog '"$INSTDIR\resources\henshin-cam\henshin-vcam-register.exe" remove'
      Pop $0
      StrCmp $0 "0" henshin_uninstall_cleanup henshin_uninstall_failed

    henshin_uninstall_missing:
      MessageBox MB_OK|MB_ICONEXCLAMATION "The Henshin camera registrar is missing. Uninstallation will continue with camera runtime cleanup."
      Goto henshin_uninstall_cleanup

    henshin_uninstall_failed:
      MessageBox MB_OK|MB_ICONEXCLAMATION "Henshin camera deregistration failed (exit code $0). Uninstallation will continue; a restart may be required to finish camera cleanup."
      Goto henshin_uninstall_cleanup
  ${EndIf}

  henshin_uninstall_cleanup:
    ; Delete only directories exclusively owned by the camera runtime.
    ReadEnvStr $2 "ProgramData"
    StrCmp $2 "" henshin_uninstall_public
    RMDir /r "$2\Henshin\Camera"

  henshin_uninstall_public:
    ReadEnvStr $1 "PUBLIC"
    StrCmp $1 "" henshin_uninstall_done

  henshin_uninstall_done:
!macroend
