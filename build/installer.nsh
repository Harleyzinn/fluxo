Var /GLOBAL fluxoSilentExistingInstall

!macro preInit
  StrCpy $fluxoSilentExistingInstall "false"
!macroend

!macro customInit
  ClearErrors
  ReadRegStr $R8 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $R8 == ""
    ClearErrors
    ReadRegStr $R8 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${EndIf}

  ${If} $R8 != ""
    StrCpy $fluxoSilentExistingInstall "true"
    ${IfNot} ${Silent}
      SetSilent silent
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  ${If} $fluxoSilentExistingInstall == "true"
  ${AndIfNot} ${isForceRun}
    HideWindow
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
  ${EndIf}
!macroend
