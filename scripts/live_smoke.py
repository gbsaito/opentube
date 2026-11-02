#!/usr/bin/env python3
"""Live TUI smoke: run opentube in a pty, reply to terminal queries, probe labels, exit."""
import os, pty, re, sys, time, select as sel

CMD = sys.argv[1:] or ["bun", "run", "src/index.tsx"]

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
    os.execvp(CMD[0], CMD)
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

def reply_for(chunk):
    out = b""
    for rx, rep in REPLIES:
        if rep is not None and rx.search(chunk):
            out += rep
    return out

ANSI = re.compile(rb"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][\x00-\xff]|\x1b\][^\x1b]*\x1b\\|[\x00-\x09\x0b-\x1a]")

buf_all = b""
def read_until(idle_ms=600, total_ms=3000):
    global buf_all
    buf, deadline, last = b"", time.time() + total_ms / 1000, time.time() + idle_ms / 1000
    while time.time() < deadline and time.time() < last:
        r, _, _ = sel.select([master], [], [], 0.06)
        if r:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if chunk:
                buf += chunk
                last = time.time() + idle_ms / 1000
    if buf:
        buf_all += buf
    return buf

def send(b):
    os.write(master, b)

out = read_until(idle_ms=1000, total_ms=8000)
rep = reply_for(out)
if rep:
    send(rep)
out += read_until(idle_ms=900, total_ms=4000)

text = ANSI.sub(b"", buf_all).decode("utf-8", "ignore").replace("\x0c", "\n")
print("== PHASE0 home ==")
for probe in ["search y", "history", "playlists", "subscriptions", "settings", "quit"]:
    print("has", repr(probe), ":", probe in text)

send(b"\x1b"); time.sleep(0.3)
for _ in range(3):
    send(b"\x1b[B"); time.sleep(0.12)
send(b"\r"); time.sleep(1.0)
read_until(idle_ms=800, total_ms=2500)
t2 = ANSI.sub(b"", buf_all).decode("utf-8", "ignore").replace("\x0c", "\n")
print("== PHASE1 settings ==", "backend" in t2, "results_count" in t2)
send(b"\x1b"); time.sleep(0.8)
read_until(idle_ms=800, total_ms=2500)
t3 = ANSI.sub(b"", buf_all).decode("utf-8", "ignore").replace("\x0c", "\n")
print("== PHASE2 back home ==", "search y" in t3)

os.kill(pid, 9)
os.waitpid(pid, 0)
