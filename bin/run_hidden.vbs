CreateObject("Wscript.Shell").Run """" & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\run_server.bat""", 0, False
