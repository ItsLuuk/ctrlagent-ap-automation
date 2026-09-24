!macro NSIS_HOOK_POSTINSTALL
  IfFileExists "$EXEDIR\Foundry-AI-Payload\manifest.json" 0 payload_missing
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\payload-installer.ps1" -PayloadDirectory "$EXEDIR\Foundry-AI-Payload" -InstallDirectory "$INSTDIR"' $0
  IntCmp $0 0 payload_done
  MessageBox MB_ICONSTOP "Foundry could not install its bundled AI payload. See the installer log for details."
  Abort
  payload_missing:
  MessageBox MB_ICONSTOP "Foundry-AI-Payload was not found next to this setup executable. Keep the complete offline installer folder together and run setup again."
  Abort
  payload_done:
!macroend
