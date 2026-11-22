"""Stage an OCCT worker and its non-system dylibs beside one another."""
import pathlib
import shutil
import subprocess
import sys

source, output, *search = map(pathlib.Path, sys.argv[1:])
output.mkdir(parents=True, exist_ok=True)
by_name = {}
staged = {}


def run(*args):
    return subprocess.check_output(args, text=True)


def libraries(path):
    return [line.strip().split(" (", 1)[0] for line in
            run("otool", "-L", path).splitlines()[1:]]


def stage(path, name):
    if name in staged:
        return
    local = output / name
    shutil.copy2(path, local)
    local.chmod(0o755)
    staged[name] = local
    links = libraries(path)
    if path.suffix == ".dylib":
        run("install_name_tool", "-id", "@loader_path/" + name, local)
        links = links[1:]
    for link in links:
        if link.startswith(("/usr/lib/", "/System/Library/")):
            continue
        dependency = pathlib.Path(link)
        target = next((p for p in [dependency, path.parent / dependency.name,
                      *(d / dependency.name for d in search)] if p.is_file()), None)
        if target is None:
            raise RuntimeError(f"Missing OCCT runtime library: {link}")
        previous = by_name.setdefault(dependency.name, target.resolve())
        if previous != target.resolve():
            raise RuntimeError(f"Conflicting OCCT libraries named {dependency.name}")
        stage(target, dependency.name)
        run("install_name_tool", "-change", link, "@loader_path/" + dependency.name, local)


stage(source, source.name)
for executable in reversed(staged.values()):
    run("codesign", "--force", "--sign", "-", executable)
