#!/usr/bin/env python3
"""probe: replay EXACT startup reply chunks + keys captured from user's kitty."""
import os, pty, re, time, select as sel, subprocess
import sysconfig

m, s = pty.openpty()
pid = os.fork()
if pid == 0:
    os.setsid()
    import fcntl, termios, struct
    fcntl.ioctl(s, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
    os.dup2(s, 0); os.dup2(s, 1); os.dup2(s, 2)
    os.close(m); os.close(s)
    os.environ["TERM"] = "xterm-kitty"
    os.environ["OTUI_RAW"] = "1"
    os.execvp("bun", ["bun", "/home/saito/.local/bin/opentube-test"])
os.close(s)

CH1 = bytes.fromhex(
  "1b5d31303b7267623a633063302f636163612f663566351b5c"
  "1b5d31313b7267623a316131612f316231622f323632361b5c"
  "1b503e7c6b6974747928302e34392e32291b5c"
  "1b5b31343b3152"
  "1b50312b72346437333d3563343535643335333233623235373033313235373333623235373033323235373335633435356335631b5c"
  "1b5b3f313031363b3224791b5b3f323032373b3024791b5b3f323033313b3124791b5b3f313030343b3224791b5b3f323030343b322479")
CH2 = bytes.fromhex("1b5b3f323032363b3224791b5b3f3075")
CH3 = bytes.fromhex(
  "1b5d39393b693d6f70656e7475692d6e6f74696669636174696f6e733a703d3f3b613d666f6375732c7265706f72743a6f3d616c776179732c756e666f63757365642c696e76697369626c653a753d302c312c323a703d7469746c652c626f64792c3f2c636c6f73652c69636f6e2c616c6976652c627574746f6e733a633d313a773d313a733d73797374656d2c73696c656e742c6572726f722c696e666f2c7175657374696f6e2c7761726e2c7761726e696e671b5c"
  "1b5f47693d33313333373b4f4b1b5c"
  "1b5b3f36323b35323b631b5b313b32521b5b313b3352")
CH4 = bytes.fromhex("1b5b343b313034303b3130373174")
REPLY_SET = CH1 + CH2 + CH3 + CH4

MARKS = (b"\x1b]10;?", b"\x1b]11;?", b"\x1b]>0q", b"\x1bP+q", b"\x1b[?u",
         b"\x1b[6n", b"\x1b[c", b"\x1b]1337", b"\x1b]99;", b"\x1b_Gi=")
rounds = {"n": 0}
def pump(buf, cap=10):
    if any(k in buf for k in MARKS) and rounds["n"] < cap:
        os.write(m, REPLY_SET)
        rounds["n"] += 1

def flatten(b: bytes) -> str:
    b = re.sub(rb"\x1b\[[0-9;?<=>]*[!$]*[a-zA-Z=]", b"", b)
    b = re.sub(rb"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", b"", b)
    b = re.sub(rb"\x1b[PX_^][^\x1b]*?\x1b\\", b"", b)
    b = re.sub(rb"[\x00-\x08\x0b\x0c\x0e-\x1f]", b"", b)
    return b.decode("utf8", "ignore")

def drain(dur, idle=1.0):
    buf, dl, last = b"", time.time()+dur, time.time()+idle
    while time.time() < dl and time.time() < last:
        r,_,_ = sel.select([m],[],[],0.05)
        if r:
            try: c = os.read(m, 65536)
            except OSError: break
            if c:
                buf += c
                pump(c)
                last = time.time()+idle
    return buf

KEYS = [(b"hi", 0.5), (b"\r", 1.0), (b"\x1b[27u", 0.6), (b"\x09", 0.6), (b"\x1b[B", 0.6)]

time.sleep(9)
boot = drain(1.0)
print("boot bytes:", len(boot), "query rounds:", rounds, flush=True)
kb = flatten(boot)

for keys, pause in KEYS:
    os.write(m, keys)
    time.sleep(pause)
    chunk = drain(1.5, 1.2)
    mark = b"findMe" if False else keys
    got_searching = b"searching via invidious" in chunk
    got_adele = b"Adele" in chunk or b"Alan Walker" in chunk
    print("KEY", keys.hex(), "reply", len(chunk), "B searching", got_searching, "adele", got_adele, flush=True)
    if b"\r" in mark:
        # let search do the network round; extra 14s of drain
        pass

post = drain(15.0, 2.0)
flat = flatten(boot + post) + kb
hits = ("searching via invidious" in flat, "Adele" in flat, "Alan Walker" in flat)
print("POST:", len(post), "B | searching/Adele/Walker:", hits, flush=True)
try:
    os.kill(pid, 9); os.waitpid(pid, 0)
except ChildProcessError:
    pass
