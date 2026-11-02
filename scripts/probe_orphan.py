#!/usr/bin/env python3
"""probe: opentube child aliveness after master close."""
import os, pty, time, subprocess

m, s = pty.openpty()
pid = os.fork()
if pid == 0:
    os.setsid()
    import fcntl, termios, struct
    fcntl.ioctl(s, termios.TIOCSWINSZ, struct.pack("HHHH", 28, 90, 0, 0))
    os.dup2(s, 0); os.dup2(s, 1); os.dup2(s, 2)
    os.close(m); os.close(s)
    os.environ["TERM"] = "xterm-256color"
    os.environ["OTUI_DEBUG"] = "1"
    os.execvp("bun", ["bun", "run", "bin/opentube.ts"])
os.close(s)
time.sleep(7)
os.close(m)
for i in range(9):
    time.sleep(1)
    alive = subprocess.run(["kill", "-0", str(pid)], capture_output=True).returncode == 0
    print(f"t=+{i+1}s alive={alive}")
    if not alive:
        print("ORPHAN EXITED")
        break
if alive:
    os.kill(pid, 9)
