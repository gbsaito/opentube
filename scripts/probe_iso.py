#!/usr/bin/env python3
"""probe: isolate which lumped chunk content wedges stdinParser."""
import os, pty, re, time, select as sel, sys

VARIANT = sys.argv[1] if len(sys.argv) > 1 else "mixed"

m, s = pty.openpty()
pid = os.fork()
if pid == 0:
    os.setsid()
    import fcntl, termios, struct
    fcntl.ioctl(s, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
    os.dup2(s, 0); os.dup2(s, 1); os.dup2(s, 2)
    os.close(m); os.close(s)
    os.environ["TERM"] = "xterm-kitty"
    os.execvp("bun", ["bun", "/home/saito/.local/bin/opentube-test"])
os.close(s)

REPLIES = [
    (re.compile(rb"\x1b\]10;\?\x07"), b"\x1b]10;rgb:c0c0/caca/f5f5\x07"),
    (re.compile(rb"\x1b\]11;\?\x07"), b"\x1b]11;rgb:1a1a/1b1b/2626\x07"),
    (re.compile(rb"\x1b\]>0q"), b"\x1bP>|kitty(0.49.2)\x1b\\"),
    (re.compile(rb"\x1b\[6n"), b"\x1b[1;2R\x1b[1;3R"),
    (re.compile(rb"\x1b\[c"), b"\x1b[?62;52;c"),
    (re.compile(rb"\x1bP\+q[0-9a-fA-F]{4,8}\x1b\\"), b"\x1bP1+r4d73=5c455d3532 3b257053\x1b\\"),
    (re.compile(rb"\x1b\[\?u"), b"\x1b[?0u"),
    (re.compile(rb"\x1b\]1337;Capabilities\x07"), b"\x1b_Gi=31337;OK\x1b\\"),
    (re.compile(rb"\x1b\]99;[^\x1b]*\x1b\\"), b"\x1b]99;i=opentui-notifications:p=?\x1b\\"),
    (re.compile(rb"\x1b_Gi=(\d+)"), b"\x1b_Gi=31337;OK\x1b\\"),
]

def drain(dur, idle=0.6):
    buf, dl, last = b"", time.time()+dur, time.time()+idle
    while time.time() < dl and time.time() < last:
        r,_,_ = sel.select([m],[],[],0.05)
        if r:
            try: c = os.read(m, 65536)
            except OSError: break
            if c:
                buf += c; last = time.time()+idle
                for rx, rr in REPLIES:
                    if rx.search(c): os.write(m, rr)
    return buf

def flatten(b: bytes) -> str:
    b = re.sub(rb"\x1b\[[0-9;?<=>]*[!$]*[a-zA-Z=]", b"", b)
    b = re.sub(rb"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", b"", b)
    b = re.sub(rb"\x1b[PX_^_][^\x1b]*?\x1b\\", b"", b)
    b = re.sub(rb"[\x00-\x08\x0b\x0c\x0e-\x1f]", b"", b)
    return b.decode("utf8","ignore")

VARIANTS = {
    "text":     b"hi\r",                # only typing + enter
    "legacy":   b"hi\r\x1b\x1b[B\x09", # enter + legacy esc/arrows + tab
    "kitty":    b"hi\r\x1b[27u\x1b[B\x09", # enter + kitty-encoded esc + down + tab
    "mouse":    b"hi\r\x1b[<35;55;37M",   # enter + one mouse event
    "stream":   b"hi\r\x1b[<35;55;37M\x1b[<35;56;37m",  # mouse press+release
}
LUMP = VARIANTS[VARIANT]

time.sleep(9)
boot = drain(1.0)
os.write(m, LUMP)
rnd = drain(8.0, 2.0)
flat = flatten(boot + rnd)
searching = "searching via invidious" in flat
print(f"{VARIANT}: lump={len(LUMP)}B reply={len(rnd)}B searching={searching}", flush=True)
# post-activity check: does more input get through afterwards?
time.sleep(1)
os.write(m, b"zz\x09\x1b[B")
rnd2 = drain(4.0, 1.5)
print(f"{VARIANT}: post bytes={len(rnd2)}", flush=True)
try: os.kill(pid, 9); os.waitpid(pid, 0)
except ChildProcessError: pass
