Option Explicit

Dim shell, fileSystem, scriptDirectory, bootstrapPath, powershellPath, command

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
bootstrapPath = fileSystem.BuildPath(scriptDirectory, "bootstrap-tauri-dev.ps1")
powershellPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"

If Not fileSystem.FileExists(bootstrapPath) Then
  Err.Raise vbObjectError + 1, "Foundry launcher", "Bootstrap script not found: " & bootstrapPath
End If

command = """" & powershellPath & """ -NoProfile -ExecutionPolicy Bypass -File """ & bootstrapPath & """"
shell.Run command, 0, False
