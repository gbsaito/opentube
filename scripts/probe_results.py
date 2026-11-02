#!/usr/bin/env python3
"""watch production search flow: frame probes with timestamps."""
import os, pty, re, time, select as sel

master, slave = pty.openpty()
pid = os.fork()
if pid == 0:
    os.setsid()
    import fcntl, termios, struct
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 100, 0, 0))
    os.dup2(slave, 0); os.dup2(slave, 1); os.dup2(slave, 2)
    os.close(master); os.close(slave)
    os.environ["TERM"] = "xterm-256color"
    os.environ["OTUI_PALETTE_IDLE_TIMEOUT_MS"] = "1200"
    os.execvp("bun", ["bun", "run", "bin/opentube.ts"])
os.close(slave)
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

def read_until(idle_ms=600, total_ms=3000):
    buf, dl, last = b"", time.time() + total_ms / 1000, time.time() + idle_ms / 1000
    while time.time() < dl and time.time() < last:
        r, _, _ = sel.select([master], [], [], 0.06)
        if r:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if chunk:
                buf += chunk
                last = time.time() + idle_ms / 1000
    rep = b""
    for rx, rr in REPLIES:
        if rx.search(buf):
            rep += rr
    if rep:
        os.write(master, rep)
    return buf

def send(b):
    os.write(master, b)

read_until(idle_ms=1500, total_ms=9000)
send(b"hello"); time.sleep(0.5)
send(b"\r")
t0 = time.time()
for _ in range(10):
    buf = read_until(idle_ms=1500, total_ms=6000)
    b = buf
    b = re.sub(rb"\x1b\[[0-9;?<=>]*[!$]*[a-zA-Z=]", b"", b)
    b = re.sub(rb"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", b"", b)
    b = re.sub(rb"\x1b[PX_^][^\x1b]*?\x1b\\", b"", b)
    b = re.sub(rb"\x1b[()][0-9A-B]?", b"", b)
    b = re.sub(rb"[\x00-\x08\x0b\x0c\x0e-\x1f]", b"", b)
    t = b.decode("utf8", "ignore")
    print(f"--- t={time.time()-t0:.1f}s bytes={len(buf)} searching={'searching via invidious' in t or 'searching' in t} err={'error' in t.lower()} adele={'Adele' in t}")
os.kill(pid, 9)
os.waitpid(pid, 0)
