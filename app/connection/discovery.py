# Find an installed ngrok executable in bounded portable locations.
import shutil
from pathlib import Path
from app.config import ROOT


# Find a configured or portably installed ngrok executable.
def find_ngrok(configured='', root=ROOT, home=None):

    home = home or Path.home()
    if configured:
        candidate = Path(configured).expanduser()
        return candidate.resolve() if candidate.is_file() else None
    names = ('ngrok.exe', 'ngrok')
    candidates = [root / name for name in names] + [root / 'tools' / name for name in names]
    found = shutil.which('ngrok')
    if found:
        candidates.append(Path(found))
    for folder in (root.parent, root.parent.parent, home / 'Desktop', home / 'Downloads', home / 'OneDrive' / 'Desktop'):
        candidates.extend(folder / name for name in names)
        if folder.is_dir():
            candidates.extend(sorted(folder.glob('*ngrok*/*.exe')))
            candidates.extend(sorted(folder.glob('*ngrok*/ngrok')))
    for candidate in candidates:
        if candidate.is_file() and candidate.name.lower() in names:
            return candidate.resolve()
    return None
