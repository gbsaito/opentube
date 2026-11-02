#!/usr/bin/env python3
"""pty-probe: search + capture frame to check sidebar description rendering."""
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
buf_all = b""

def read_until(idle_ms=600, total_ms=3000):
    global buf_all
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
    if buf:
        buf_all += buf
    return buf

def send(b):
    os.write(master, b)

def text():
    b = buf_all
    b = re.sub(rb"\x1b\[[0-9;?<=>]*[!$]*[a-zA-Z=]", b"", b)   # CSI
    b = re.sub(rb"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", b"", b)  # OSC
    b = re.sub(rb"\x1b[PX_^][^\x1b]*?\x1b\\", b"", b)           # DCS/APC/SOS
    b = re.sub(rb"\x1b[()][0-9A-B]?", b"", b)                    # charset
    b = re.sub(rb"[\x00-\x08\x0b\x0c\x0e-\x1f]", b"", b)         # ctrl
    return b.decode("utf8", "ignore")

def drain(idle_ms, total_ms):
    read_until(idle_ms=idle_ms, total_ms=total_ms)

drain(1500, 9000)
send(b"lofi"); time.sleep(0.5)
send(b"\r")
drain(3000, 115000)  # yt-dlp full-metadata search takes ~90s
t = text()
print("LEN:", len(t))
print("HAS DESCRIPTION WORDS:", any(w in t for w in ["Channel:", "Upload Date", "Views:", "Description", "lofi", "Internet", "music", "radio", "beat"]))
lines = [l for l in t.split("\n") if l.strip()]
print("\n".join(lines[60:130]))
open("/tmp/opentube_probe_out.txt", "w").write(t)
os.kill(pid, 9)
os.waitpid(pid, 0)
