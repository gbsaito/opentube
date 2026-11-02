#!/usr/bin/env python3
"""pty-probe for opentube home screen: reports row/col of key UI elements.
Usage: python3 scripts/probe_home.py [cmd1 key-bytes-hex] ..."""
import os, pty, re, time, sys, select as sel

W, H = 110, 26
master, slave = pty.openpty()
pid = os.fork()
if pid == 0:
    os.setsid()
    import fcntl, termios, struct
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", H, W, 0, 0))
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


def paint(frame):
    """positional renderer -> {row: {col: char}}"""
    grid = {}
    row, col = 0, 0
    for m in re.finditer(rb"\x1b\[([0-9;]*)([A-Za-zJ])|([^\x1b]+)", frame, re.S):
        params, cmd, text = m.group(1), m.group(2), m.group(3)
        if cmd is not None:
            p = [int(x) for x in (params or b"").split(b";") if x]
            if cmd == b"H":  # absolute move: 1-based
                row = (p[0] if len(p) > 0 else 1) - 1
                col = (p[1] if len(p) > 1 else 1) - 1
            elif cmd == b"C":  # forward
                col += p[0] if p else 1
            elif cmd == b"D":
                col -= p[0] if p else 1
        elif text:
            for ch in text.decode("utf8", "ignore"):
                if ch == "\n":
                    row += 1; col = 0
                elif ch == "\r":
                    col = 0
                elif ch >= " ":
                    grid.setdefault(row, {})[col] = ch
                    col += 1
    return grid


def line_at(grid, row):
    d = grid.get(row, {})
    if not d:
        return ""
    lo, hi = min(d), max(d)
    return "".join(d.get(c, " ") for c in range(lo, hi + 1))


boot = read_until(idle_ms=1500, total_ms=9000)

# replay steps: (label, hex-bytes), frames captured after each
steps = []
for arg in sys.argv[1:]:
    if ":" in arg and not arg.startswith("q:"):
        label, hx = arg.split(":", 1)
        steps.append((label, bytes.fromhex(hx)))

grid = {}
for arg in steps:
    os.write(master, arg[1]); time.sleep(0.4)
    fr = FRAME.findall(read_until(idle_ms=400, total_ms=2500))
    if fr:
        grid = paint(fr[-1])
    print(f"-- {arg[0]}")

# grab one settled frame
time.sleep(0.3)
frames = FRAME.findall(read_until(idle_ms=500, total_ms=3000))
if frames:
    grid = paint(frames[-1])

# report interesting lines
targets = ["tab switch", "search", "istory", "laylists", "ubscription", "ettings", "uit", "opentube"]
for r in sorted(grid):
    line = line_at(grid, r)
    s = line.strip()
    if any(t in line for t in targets) and s:
        first = next(c for c, ch in grid.get(r, {}).items() if ch.strip())
        print(f"row {r:2d} first-char col {first:2d} | {line.rstrip()}")
os.kill(pid, 9); os.waitpid(pid, 0)
