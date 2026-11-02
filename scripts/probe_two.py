#!/usr/bin/env python3
"""two-instance live test: both instances must receive typed keys + respond."""
import os, pty, re, time, select as sel, subprocess

def child_maybe_replies():
    pass

REPLIES = [
    (re.compile(rb"\x1b\]10;\?(\x07|\x1b\\)"), b"\x1b]10;rgb:c7c7/c7c7/c7c7\x07"),
    (re.compile(rb"\x1b\]11;\?(\x07|\x1b\\)"), b"\x1b]11;rgb:1818/1818/1b1b\x07"),
    (re.compile(rb"\x1b\[\>0q"), b"\x1bP>|python-pty\x1b\\"),
    (re.compile(rb"\x1b\[6n"), b"\x1b[1;1R"),
    (re.compile(rb"\x1b\[c"), b"\x1b[?62;1;2;6;7;8;9;15;18c"),
    (re.compile(rb"\x1bP\+q[0-9a-f]{2,}(\x07|\x1b\\)"), b"\x1bP+q\x1b\\"),
    (re.compile(rb"\x1b\[\?u"), b"\x1b[?0u"),
    (re.compile(rb"\x1b_Gi=(\d+)[^\x1b]*(\x1b\\|\x07)"), b"\x1b_Gi=31337;OK\x1b\\"),
]

def make(master, pid):
    os.close(slave_dummy)

def spawn(pty_fd):
    pass

pids = []
masters = []
for _ in range(2):
    m, s = pty.openpty()
    pid = os.fork()
    if pid == 0:
        os.setsid()
        import fcntl, termios, struct
        fcntl.ioctl(s, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
        os.dup2(s, 0); os.dup2(s, 1); os.dup2(s, 2)
        os.close(m); os.close(s)
        os.environ["TERM"] = "xterm-256color"
        os.environ["OTUI_PALETTE_IDLE_TIMEOUT_MS"] = "1200"
        os.execvp("bun", ["bun", "/home/saito/.local/bin/opentube"])
    os.close(s)
    masters.append(m)
    pids.append(pid)

time.sleep(9)
results = []
for i, m in enumerate(masters):
    os.write(m, b"two")
    time.sleep(0.8)
    os.write(m, b"\r")
for i, m in enumerate(masters):
    buf = b""
    dl = time.time() + 25
    last = time.time() + 3
    while time.time() < dl and time.time() < last:
        r, _, _ = sel.select([m], [], [], 0.06)
        if r:
            c = os.read(m, 65536)
            if c: buf += c; last = time.time() + 3
    rep = b""
    for rx, rr in REPLIES:
        if rx.search(buf): rep += rr
    if rep: os.write(m, rep)
    b = buf
    b = re.sub(rb"\x1b\[[0-9;?<=>]*[!$]*[a-zA-Z=]", b"", b)
    b = re.sub(rb"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", b"", b)
    b = re.sub(rb"\x1b[PX_^][^\x1b]*?\x1b\\", b"", b)
    b = re.sub(rb"\x1b[()][0-9A-B]?", b"", b)
    b = re.sub(rb"[\x00-\x08\x0b\x0c\x0e-\x1f]", b"", b)
    t = b.decode("utf8", "ignore")
    results.append(t)
    print(f"INSTANCE {i}: searching={'searching via invidious' in t} content={'Adele' in t or 'Alan Walker' in t} has_typed={'two' in t}")

for pid in pids:
    os.kill(pid, 9)
    os.waitpid(pid, 0)
for m in masters:
    os.close(m)
