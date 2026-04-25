#define AppName "BD Engine"
#define AppPublisher "BD Engine"
#ifndef AppVersion
#define AppVersion "0.1.0"
#endif
#ifndef SourceDir
#define SourceDir "..\..\dist\windows\app"
#endif
#ifndef OutputDir
#define OutputDir "..\..\dist"
#endif

[Setup]
AppId={{B94C70CF-03C0-4AF2-8A4C-8468A5E0BDE1}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\BD Engine
DefaultGroupName=BD Engine
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=BD-Engine-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName={#AppName}
VersionInfoVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription=BD Engine Windows Installer
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: checkedonce

[Dirs]
Name: "{localappdata}\BD Engine"
Name: "{localappdata}\BD Engine\Data"
Name: "{localappdata}\BD Engine\Logs"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\BD Engine"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\BD-Engine-Launcher.ps1"""; WorkingDir: "{app}"
Name: "{autodesktop}\BD Engine"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\BD-Engine-Launcher.ps1"""; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\BD-Engine-Launcher.ps1"""; Description: "Launch BD Engine"; Flags: postinstall nowait skipifsilent unchecked

[Code]
var
  DeleteUserData: Boolean;

function InitializeUninstall(): Boolean;
var
  Choice: Integer;
begin
  DeleteUserData := False;
  Choice := MsgBox(
    'Do you also want to delete BD Engine user data from ' + ExpandConstant('{localappdata}\BD Engine') + '?' + #13#10 + #13#10 +
    'Choose No to keep your database, settings, logs, and import history for future installs.',
    mbConfirmation,
    MB_YESNO
  );
  if Choice = IDYES then begin
    DeleteUserData := True;
  end;

  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and DeleteUserData then begin
    DelTree(ExpandConstant('{localappdata}\BD Engine'), True, True, True);
  end;
end;
