"""Tests For pdrive-web: Security Checks, Login, Compare, Cache And Mirror.

Run:  tests/run.sh   (Needs Python 3.9+; The Transfer Tests Also Need A Real rclone,
Found On PATH Or Through REAL_RCLONE, And Are Skipped Without It.)
"""
import http.client
import importlib.machinery
import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REAL = os.environ.get("REAL_RCLONE") or shutil.which("rclone")


def load_module():
    loader = importlib.machinery.SourceFileLoader("pdrive_web", str(ROOT / "pdrive-web"))
    spec = importlib.util.spec_from_loader("pdrive_web", loader)
    mod = importlib.util.module_from_spec(spec)
    old = os.environ.get("PDRIVE_LOCAL_ROOT")
    os.environ.pop("PDRIVE_LOCAL_ROOT", None)
    try:
        loader.exec_module(mod)
    finally:
        if old is not None:
            os.environ["PDRIVE_LOCAL_ROOT"] = old
    return mod


class Units(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = load_module()

    def test_parse_time(self):
        self.assertEqual(self.m.parse_time("2020-01-02T03:04:05Z"), 1577934245)
        self.assertEqual(self.m.parse_time("2020-01-02T04:04:05.5+01:00"), 1577934245.5)
        self.assertIsNone(self.m.parse_time("nonsense"))

    def test_classify(self):
        c = self.m.classify
        self.assertEqual(c((5, 100), None, False), "only_local")
        self.assertEqual(c(None, (5, 100), False), "only_remote")
        self.assertEqual(c((5, 100), (5, 101), False), "same")            # Within 2 Seconds
        self.assertEqual(c((5, 100), (5, 200), False), "remote_newer")
        self.assertEqual(c((5, 200), (5, 100), False), "local_newer")
        self.assertEqual(c((5, 200), (5, 100), True), "same")             # Ignore Time
        self.assertEqual(c((5, 100), (6, 100), False), "differs")

    def test_relative_paths_are_checked(self):
        ok = self.m.check_rel_paths(["a.txt", "d/e.txt"])
        self.assertEqual(ok, ["a.txt", "d/e.txt"])
        for bad in ["../x", "/abs", "a/../b", "", "a//b", "x\ny", "./a"]:
            with self.assertRaises(self.m.ApiError, msg=bad):
                self.m.check_rel_paths([bad])

    def test_conflict_flags(self):
        self.assertEqual(self.m.conflict_flags(2)[0], ["--ignore-existing"])
        self.assertEqual(self.m.conflict_flags(3)[0], ["--update"])
        self.assertIn("--suffix-keep-extension", self.m.conflict_flags(4)[0])

    def test_clean_name(self):
        for bad in ["", "a/b", "..", ".", None]:
            with self.assertRaises(self.m.ApiError):
                self.m.clean_name(bad)
        self.assertEqual(self.m.clean_name("ok name"), "ok name")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@unittest.skipUnless(REAL, "A real rclone is needed (PATH or REAL_RCLONE)")
class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="pdrive-test-"))
        cls.state, cls.drive = cls.tmp / "state", cls.tmp / "drive"
        cls.root, cls.home = cls.tmp / "root", cls.tmp / "home"
        for d in (cls.state, cls.drive, cls.root, cls.home):
            d.mkdir()
        cls.port = free_port()
        env = dict(os.environ, PDRIVE_RCLONE=str(ROOT / "tests/fake_rclone"), REAL_RCLONE=REAL,
                   FAKE_STATE=str(cls.state), FAKE_DRIVE=str(cls.drive), HOME=str(cls.home),
                   PDRIVE_LOCAL_ROOT=str(cls.root), PDRIVE_KEY="testkey", PDRIVE_REMOTE="proton")
        cls.proc = subprocess.Popen([sys.executable, str(ROOT / "pdrive-web"), "--no-browser",
                                     "--port", str(cls.port)], env=env, stdout=subprocess.DEVNULL)
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", cls.port), 0.2).close()
                break
            except OSError:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(5)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # -- Helpers
    def req(self, method, path, body=None, cookie=True, host=None, headers=None, raw=False):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        h = {"Host": host or f"127.0.0.1:{self.port}"}
        if cookie:
            h["Cookie"] = f"pdrive_{self.port}=testkey"
        data = None
        if body is not None:
            data = body if raw else json.dumps(body)
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        c.request(method, path, data, h)
        r = c.getresponse()
        text = r.read()
        c.close()
        try:
            return r.status, json.loads(text)
        except ValueError:
            return r.status, text

    def api(self, path, body=None):
        return self.req("POST" if body is not None else "GET", "/api/" + path, body)

    def login(self):
        self.api("logout", {})
        st, _ = self.api("login", {"username": "me@proton.me", "password": "pw", "code": "123456"})
        self.assertEqual(st, 200)

    def wait_scan(self, scan_id, ignore=0):
        for _ in range(100):
            _, r = self.api(f"compare/{scan_id}?ignore_time={ignore}")
            if r["state"] != "running":
                return r
            time.sleep(0.1)
        self.fail("scan did not finish")

    def wait_job(self, body):
        st, j = self.api("jobs", body)
        self.assertEqual(st, 200, j)
        for _ in range(100):
            _, r = self.api("jobs/" + j["id"])
            if r["state"] != "running":
                return r
            time.sleep(0.1)
        self.fail("job did not finish")

    def drive_files(self):
        return sorted(str(p.relative_to(self.drive)) for p in self.drive.rglob("*") if p.is_file())

    def reset_data(self):
        shutil.rmtree(self.drive); self.drive.mkdir()
        shutil.rmtree(self.root); self.root.mkdir()
        (self.drive / "Docs/sub").mkdir(parents=True)
        (self.drive / "Docs/a.txt").write_text("aaa")
        (self.drive / "Docs/sub/b.txt").write_text("bbb")
        (self.drive / "Docs/zzz.txt").write_text("zzz")
        (self.root / "work").mkdir()
        (self.root / "work/a.txt").write_text("aaa")
        (self.root / "work/c.txt").write_text("new")
        for f in (self.drive / "Docs/a.txt", self.root / "work/a.txt"):
            os.utime(f, (1577934245, 1577934245))
        (self.state / "lsjson.calls").unlink(missing_ok=True)

    # -- Access Control
    def test_requests_without_the_cookie_are_refused(self):
        self.assertEqual(self.req("GET", "/api/status", cookie=False)[0], 401)
        self.assertEqual(self.req("GET", "/", cookie=False)[0], 403)

    def test_foreign_host_and_origin_are_refused(self):
        self.assertEqual(self.req("GET", "/api/status", host="evil.example:80")[0], 403)
        st, _ = self.req("POST", "/api/logout", {}, headers={"Origin": "http://evil.example"})
        self.assertEqual(st, 403)

    def test_post_needs_json(self):
        st, _ = self.req("POST", "/api/logout", "x=1", raw=True, headers={"Content-Type": "text/plain"})
        self.assertEqual(st, 415)

    def test_key_link_sets_a_strict_cookie(self):
        c = http.client.HTTPConnection("127.0.0.1", self.port)
        c.request("GET", "/?k=testkey", headers={"Host": f"127.0.0.1:{self.port}"})
        r = c.getresponse()
        r.read()
        c.close()
        self.assertEqual(r.status, 302)
        cookie = r.getheader("Set-Cookie")
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)

    # -- Login
    def test_login_flow(self):
        self.api("logout", {})
        self.assertFalse(self.api("status")[1]["logged_in"])
        self.assertEqual(self.api("ls?path=/")[0], 401)
        st, r = self.api("login", {"username": "me@proton.me", "password": "pw", "code": "111111"})
        self.assertEqual(st, 401)
        self.assertFalse(self.api("status")[1]["logged_in"])            # No Half-Made Remote
        st, r = self.api("login", {"username": "me@proton.me", "password": "pw", "code": "000429"})
        self.assertEqual(st, 429)
        self.assertEqual(self.api("login", {"username": "me@proton.me", "password": ""})[0], 400)
        self.assertEqual(self.api("login", {"username": "a b", "password": "x"})[0], 400)
        self.assertEqual(self.api("login", {"username": "me@proton.me", "password": "pw", "code": "12ab"})[0], 400)
        self.login()
        st = self.api("status")[1]
        self.assertTrue(st["logged_in"])
        self.assertEqual(st["account"], "me@proton.me")
        self.api("logout", {})
        self.assertFalse(self.api("status")[1]["logged_in"])

    # -- Local Folder
    def test_local_folder_is_confined_to_the_root(self):
        self.reset_data()
        self.assertEqual(self.api("settings", {"sync_dir": "/etc"})[0], 403)
        self.assertEqual(self.api("local?path=/etc")[0], 403)
        self.assertEqual(self.api("local_mkdir", {"path": str(self.root), "name": "../x"})[0], 400)
        st, r = self.api("local_mkdir", {"path": str(self.root), "name": "mine"})
        self.assertEqual(st, 200)
        self.assertEqual(self.api("settings", {"sync_dir": r["path"]})[0], 200)
        self.assertEqual(self.api("status")[1]["sync_dir"], r["path"])

    # -- Compare, Cache, Cancel
    def test_compare_and_cache(self):
        self.reset_data(); self.login()
        local = str(self.root / "work")
        st, a = self.api("compare/start", {"local": local, "remote": "/Docs"})
        self.assertEqual(st, 200)
        r = self.wait_scan(a["id"])
        self.assertEqual(r["state"], "done", r)
        counts = r["result"]["counts"]
        self.assertEqual((counts["same"], counts["only_local"], counts["only_remote"]), (1, 1, 2))
        calls = lambda: len((self.state / "lsjson.calls").read_text().split())
        self.assertEqual(calls(), 1)
        b = self.api("compare/start", {"local": local, "remote": "/Docs"})[1]
        self.assertIsNotNone(self.wait_scan(b["id"])["cached_at"])
        c = self.api("compare/start", {"local": local, "remote": "/Docs/sub"})[1]
        r = self.wait_scan(c["id"])
        self.assertIsNotNone(r["cached_at"])                              # Sub-Folder From The Cache
        self.assertEqual(calls(), 1)
        d = self.api("compare/start", {"local": local, "remote": "/Docs", "refresh": True})[1]
        self.wait_scan(d["id"])
        self.assertEqual(calls(), 2)

    def test_compare_ignore_time_reclassifies_without_reading(self):
        self.reset_data(); self.login()
        os.utime(self.root / "work/a.txt", (1577934245 + 9999, 1577934245 + 9999))
        a = self.api("compare/start", {"local": str(self.root / "work"), "remote": "/Docs", "refresh": True})[1]
        self.assertEqual(self.wait_scan(a["id"])["result"]["counts"]["local_newer"], 1)
        self.assertEqual(self.wait_scan(a["id"], ignore=1)["result"]["counts"]["same"], 1)

    def test_compare_can_be_cancelled(self):
        self.reset_data(); self.login()
        scan = self.api("compare/start", {"local": str(self.root / "work"), "remote": "/Docs", "refresh": True})[1]
        self.api(f"compare/{scan['id']}/cancel", {})
        r = self.wait_scan(scan["id"])
        self.assertIn(r["state"], ("cancelled", "done"))                  # Done If It Finished First
        self.assertFalse(self.api("status")[1]["busy"])

    def test_missing_remote_folder_is_reported(self):
        self.reset_data(); self.login()
        a = self.api("compare/start", {"local": str(self.root / "work"), "remote": "/Nope", "refresh": True})[1]
        r = self.wait_scan(a["id"])
        self.assertFalse(r["result"]["remote_exists"])
        self.assertEqual(r["result"]["counts"]["only_local"], 2)

    # -- Mirror
    def mirror_body(self, **kw):
        body = {"kind": "upload_files", "local_dir": str(self.root / "work"), "remote_dir": "/Docs",
                "paths": ["c.txt"], "delete_paths": ["sub/b.txt", "zzz.txt"], "conflict": 1}
        body.update(kw)
        return body

    def test_deletions_need_the_confirmation_word(self):
        self.reset_data(); self.login()
        self.assertEqual(self.api("jobs", self.mirror_body(dry_run=True))[0], 400)
        self.assertEqual(self.api("jobs", self.mirror_body(confirm="delete"))[0], 400)

    def test_paths_cannot_escape(self):
        self.reset_data(); self.login()
        self.assertEqual(self.api("jobs", self.mirror_body(delete_paths=["../x"], confirm="DELETE"))[0], 400)
        self.assertEqual(self.api("jobs", self.mirror_body(paths=["/etc/passwd"]))[0], 400)

    def test_mirror_preview_changes_nothing_and_real_run_does(self):
        self.reset_data(); self.login()
        before = self.drive_files()
        r = self.wait_job(self.mirror_body(confirm="DELETE", dry_run=True))
        self.assertEqual(r["state"], "done")
        self.assertEqual(self.drive_files(), before)
        r = self.wait_job(self.mirror_body(confirm="DELETE", dry_run=False))
        self.assertEqual(r["state"], "done", r["log"])
        self.assertEqual(self.drive_files(), ["Docs/a.txt", "Docs/c.txt"])
        self.assertEqual(sorted(p.name for p in (self.root / "work").iterdir()), ["a.txt", "c.txt"])

    def test_mirror_to_local_deletes_only_local_files(self):
        self.reset_data(); self.login()
        (self.root / "work/only_here.txt").write_text("x")
        r = self.wait_job({"kind": "download_files", "local_dir": str(self.root / "work"), "remote_dir": "/Docs",
                           "paths": [], "delete_paths": ["only_here.txt"], "confirm": "DELETE", "conflict": 1})
        self.assertEqual(r["state"], "done", r["log"])
        self.assertFalse((self.root / "work/only_here.txt").exists())
        self.assertEqual(len(self.drive_files()), 3)                      # The Drive Is Untouched

    def test_upload_clears_the_cache(self):
        self.reset_data(); self.login()
        local = str(self.root / "work")
        self.wait_scan(self.api("compare/start", {"local": local, "remote": "/Docs"})[1]["id"])
        self.wait_job({"kind": "upload_files", "local_dir": local, "remote_dir": "/Docs",
                       "paths": ["c.txt"], "conflict": 1})
        r = self.wait_scan(self.api("compare/start", {"local": local, "remote": "/Docs"})[1]["id"])
        self.assertIsNone(r["cached_at"])
        self.assertEqual(r["result"]["counts"]["only_local"], 0)

    def test_keep_both_makes_a_backup(self):
        self.reset_data(); self.login()
        (self.root / "work/a.txt").write_text("a longer second version")
        r = self.wait_job({"kind": "upload_files", "local_dir": str(self.root / "work"), "remote_dir": "/Docs",
                           "paths": ["a.txt"], "conflict": 4})
        self.assertEqual(r["state"], "done", r["log"])
        names = [n for n in self.drive_files() if n.startswith("Docs/a")]
        self.assertEqual(len(names), 2, names)
        self.assertTrue(any(".old-" in n and n.endswith(".txt") for n in names))


if __name__ == "__main__":
    unittest.main()
