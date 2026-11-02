#!/usr/bin/env python3
"""pty-probe: navigate home quick menu to playlists screen, dump frame."""
import os, pty, re, time, select as sel

master, slave = pty.openpty()
pid = os.fork()
if pid == 0:
    os.setsid()
    import fcntl, termios, struct
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 26, 110, 0, 0))
    os.dup2(slave, 0); os.dup2(slave, 1); os.dup2(slave, 2)
    os.close(master); os.close(slave)
    os.environ["TERM"] = "xterm-256color"
    os.execvp("bun", ["bun", "run", "bin/opentube.ts"])
os.close(slave)
REPLIES = [
    (re.compile(rb"\x1b\]10;\?(?:\x07|\x1b\\)"), b"\x1b]10;rgb:c7c7/c7c7/c7c7\x07"),
    (re.compile(rb"\x1b\]11;\?(?:\x07|\x1b\\)"), b"\x1b]11;rgb:1818/1818/1b1b\x07"),
    (re.compile(rb"\x1b\[\>0q"), b"\x1bP>|pty\x1b\\"),
    (re.compile(rb"\x1b\[6n"), b"\x1b[1;1R"),
    (re.compile(rb"\x1b\[c"), b"\x1b[?62;c"),
    (re.compile(rb"\x1bP\+q[0-9a-f]{2,}(?:\x07|\x1b\\)"), b"\x1bP+q\x1b\\"),
    (re.compile(rb"\x1b\[\?u"), b"\x1b[?0u"),
    (re.compile(rb"\x1b_Gi=\d+"), b"\x1b_Gi=31337;OK\x1b\\"),
]
FRAME = re.compile(rb"\x1b\[\?2026h(.*?)\x1b\[\?2026l", re.S)
CELL = re.compile(rb"\x1b\[38;2;\d+;\d+;\d+m\x1b\[48;2;\d+;\d+;\d+m|\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP.*?\x1b\\|[\x00-\x09\x0b-\x1a]")


def read_until(idle_ms=500, total_ms=3000):
    buf, dl, last = b"", time.time() + total_ms / 1000, time.time() + idle_ms / 1000
    while time.time() < dl and time.time() < last:
        r, _, _ = sel.select([master], [], [], 0.05)
        if r:
            try:
                c = os.read(master, 65536)
            except OSError:
                break
            if c:
                buf += c
                last = time.time() + idle_ms / 1000
    rep = b""
    for rx, rr in REPLIES:
        if rx.search(buf):
            rep += rr
    if rep:
        os.write(master, rep)
    return buf


def frame_txt():
    fr = FRAME.findall(read_until(idle_ms=500, total_ms=3000))
    return CELL.sub(b"", fr[-1]).decode("utf8", "ignore") if fr else ""


def step(keys, wait=0.5):
    os.write(master, keys)
    time.sleep(wait)
    return frame_txt()


read_until(idle_ms=1500, total_ms=9000)
step(b"\x1b")  # unfocus (app starts with searchbox focused)
step(b"\x1b[B")  # quick menu: history -> playlists
t = step(b"\r", wait=1.0)
print("on playlists screen:", "nothing here yet" in t or "opentube" in t)
print(repr(t[:400]))
os.kill(pid, 9); os.waitpid(pid, 0)
