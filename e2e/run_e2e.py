"""
ADGRID E2E 回帰スイート (F-29)。
稼働中のサーバ (API:4000 / Web:3000) に対し、主要フローと提供先分離を検証する。
実行: python e2e/run_e2e.py   (先に API と Web を起動しておくこと)
デモ: 自社 demo@adgrid.jp / 提供先 client@adgrid.jp (共通 demo-pass-2026)
"""
import json
import sys
import urllib.request
import urllib.error
import urllib.parse
from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

API = "http://localhost:4000"
WEB = "http://localhost:3000"
PW = "demo-pass-2026"

results = []


def check(name, cond, detail=""):
    results.append(cond)
    mark = "PASS" if cond else "FAIL"
    line = f"[{mark}] {name}"
    if detail and not cond:
        line += f"  -- {detail}"
    print(line)


def login(email, pw):
    req = urllib.request.Request(
        API + "/auth/login",
        data=json.dumps({"email": email, "password": pw}).encode(),
        headers={"Content-Type": "application/json"},
    )
    r = urllib.request.urlopen(req)
    return r.headers.get("Set-Cookie", "").split("adgrid_session=")[1].split(";")[0]


def api(tok, path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        API + path, data=data, method=method,
        headers={"Cookie": "adgrid_session=" + tok, "Content-Type": "application/json"},
    )
    try:
        r = urllib.request.urlopen(req)
        raw = r.read().decode()
        return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, None


def main():
    # ---- 1. 自社(agency) API フロー ----
    ag = login("demo@adgrid.jp", PW)
    check("自社ログイン", bool(ag))

    st, projects = api(ag, "/projects")
    check("プロジェクト一覧取得", st == 200 and isinstance(projects, list) and len(projects) >= 1,
          f"status={st}")
    pid = projects[0]["id"]

    # 業種特化クリエイティブ生成
    st, gen = api(ag, f"/projects/{pid}/creatives?count=4")
    ok_gen = st == 200 and gen and len(gen.get("variants", [])) == 4
    check("クリエイティブ生成 4案", ok_gen, f"status={st}")
    if ok_gen:
        v0 = gen["variants"][0]
        check("生成案に見出し/本文/CTA/バナー構成", all(v0.get(k) for k in ("headline", "primaryText", "cta", "bannerConcept")))

    # 採用 → 制作物が増える
    st, before = api(ag, f"/projects/{pid}")
    n_before = len(before.get("assets", [])) if before else 0
    st, adopted = api(ag, f"/projects/{pid}/creatives/adopt", "POST", {"variants": gen["variants"][:1]})
    check("クリエイティブ採用 (制作物化)", st in (200, 201) and isinstance(adopted, list) and len(adopted) == 1, f"status={st}")
    st, after = api(ag, f"/projects/{pid}")
    check("採用で制作物が1件増加", len(after.get("assets", [])) == n_before + 1)

    # 公開前チェック + 展開できない制作物の削除 (F-35)
    st, pf = api(ag, f"/projects/{pid}/preflight")
    check("公開前チェック取得", st == 200 and pf and "ready" in pf and "undeployable" in pf, f"status={st}")
    st, badAsset = api(ag, f"/projects/{pid}/assets", "POST", {"type": "lp", "title": "E2E未展開LP"})
    st, pf2 = api(ag, f"/projects/{pid}/preflight")
    flagged = any(u["assetId"] == badAsset["id"] for u in (pf2.get("undeployable") or []))
    check("URL無しLPが配信不可として検出される", flagged)
    st, _ = api(ag, f"/projects/assets/{badAsset['id']}", "DELETE")
    check("配信できない制作物を削除できる", st in (200, 204))
    st, pf3 = api(ag, f"/projects/{pid}/preflight")
    check("削除後は検出されない", not any(u["assetId"] == badAsset["id"] for u in (pf3.get("undeployable") or [])))

    # Slack → エージェント連携 (F-45): 署名検証スキップ(dev)でスラッシュコマンドが応答
    def slack(text):
        d = urllib.parse.urlencode({"command": "/adgrid", "text": text}).encode()
        rq = urllib.request.Request(API + "/slack/command", data=d, headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            resp = urllib.request.urlopen(rq)
            return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as e:
            return e.code, None
    st, sh = slack("help")
    check("Slack help に agent コマンドがある", st in (200, 201) and sh and "agent" in sh.get("text", ""), f"status={st}")

    # AI運用エージェント (F-43): 1指示で 設定反映+クリエイティブ生成 まで一気通貫
    st, agr = api(ag, f"/projects/{pid}/agent", "POST", {"instruction": "月30万円で獲得を増やして。全国"})
    check("AIエージェント一気通貫実行 (5ステップ)", st in (200, 201) and agr and len(agr.get("steps", [])) == 5, f"status={st}")
    check("エージェントが配信設定を反映 (月予算30万)", bool(agr) and agr["appliedSettings"]["monthlyBudgetTotal"] == 300000)
    check("エージェントが制作物を生成", bool(agr) and len(agr.get("createdAssetTitles", [])) >= 1)

    # 計測基盤 GA4/CAPI (F-46): ヘルス取得 → 設定保存でスコア上昇
    st, clist = api(ag, "/clients")
    cid = clist[0]["id"]
    api(ag, f"/clients/{cid}/measurement", "PUT", {"ga4MeasurementId": "", "metaPixelId": "", "serverSideEnabled": False, "enhancedConversions": False})
    st, mhLow = api(ag, f"/clients/{cid}/measurement/health")
    check("計測ヘルス取得 (score/5項目)", st == 200 and mhLow and "score" in mhLow and len(mhLow.get("items", [])) == 5, f"status={st}")
    api(ag, f"/clients/{cid}/measurement", "PUT", {"ga4MeasurementId": "G-E2E", "metaPixelId": "999", "serverSideEnabled": False, "enhancedConversions": True})
    st, mhHigh = api(ag, f"/clients/{cid}/measurement/health")
    check("計測設定を保存するとスコアが上がる", bool(mhHigh) and mhHigh["score"] > mhLow["score"], f"{mhLow.get('score')}→{mhHigh.get('score') if mhHigh else '?'}")

    # クライアント共有ポータル (F-41): 発行 → 無認証で閲覧可 → 停止で無効
    st, clients = api(ag, "/clients")
    cid = clients[0]["id"]
    st, sh = api(ag, f"/clients/{cid}/share", "POST", {})
    token = sh.get("token")
    check("共有リンク発行 (token取得)", st in (200, 201) and bool(token), f"status={st}")
    # 無認証(cookieなし)で公開ポータルが開ける
    st_anon, portal = api("", f"/share/{token}")
    check("無認証で公開ポータル閲覧可", st_anon == 200 and portal and "clientName" in portal, f"status={st_anon}")
    check("公開ポータルは1社分のKPIを返す", bool(portal and portal.get("kpi")))
    st, _ = api("", "/share/invalid_token_xyz")
    check("不正tokenは404", st == 404, f"status={st}")
    st, _ = api(ag, f"/clients/{cid}/share", "DELETE")
    st_off, _ = api("", f"/share/{token}")
    check("共有停止後は公開ポータル404", st_off == 404, f"status={st_off}")

    # ---- 2. 提供先(clientScope) の分離。clienta@ は c_a に限定された提供先アクセス ----
    cl = login("clienta@adgrid.jp", PW)
    check("提供先ログイン", bool(cl))
    st, me = api(cl, "/auth/me")
    scope = me.get("clientScopeId") if me else None
    check("提供先はクライアントスコープを持つ", bool(scope), f"scope={scope}")

    st, cprojects = api(cl, "/projects")
    check("提供先はプロジェクトを閲覧可", st == 200 and isinstance(cprojects, list))
    check("提供先に見えるのは自クライアントのみ",
          all(p["clientId"] == scope for p in (cprojects or [])),
          "他クライアントのプロジェクトが混入")

    # 他クライアントのプロジェクトには 404 (越境不可)
    foreign = next((p for p in projects if p["clientId"] != scope), None)
    if foreign:
        st, _ = api(cl, f"/projects/{foreign['id']}")
        check("提供先は他クライアントのプロジェクトを取得不可 (404)", st == 404, f"status={st}")

    # ホワイトリスト外は 403 (リセラー発行・プロジェクト作成)
    st, _ = api(cl, "/reseller/tenants")
    check("提供先はリセラー一覧を取得不可 (403)", st == 403, f"status={st}")
    st, _ = api(cl, "/projects", "POST", {"name": "x", "clientId": scope})
    check("提供先はプロジェクト作成不可 (403)", st == 403, f"status={st}")

    # 提供先はフィードバック送信可 (ホワイトリスト内)
    st, _ = api(cl, "/feedback", "POST", {"message": "E2Eテスト送信"})
    check("提供先はフィードバック送信可 (201)", st in (200, 201), f"status={st}")

    # ---- 3. UI スモーク (Playwright) ----
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 1360, "height": 1000})
        ctx.add_cookies([{"name": "adgrid_session", "value": ag, "url": u, "sameSite": "Lax"}
                         for u in (WEB, API)])
        pg = ctx.new_page()
        perr = []
        pg.on("pageerror", lambda e: perr.append(str(e)))

        pg.goto(WEB + "/", wait_until="networkidle"); pg.wait_for_timeout(1200)
        check("ホームに自律運用サイクルボード", "AI自律運用サイクル" in pg.content())

        pg.goto(f"{WEB}/projects/{pid}", wait_until="networkidle"); pg.wait_for_timeout(1200)
        body = pg.content()
        check("プロジェクトに運用サイクル(5フェーズ)",
              all(s in body for s in ("AI自律運用サイクル", "クリエイティブ作成", "確認・承認", "広告出稿・入稿", "分析・提案", "改善実行")))

        pg.get_by_role("button", name="配信設定").first.click(); pg.wait_for_timeout(800)
        check("配信設定に業種別導線設計", "業種別 導線設計" in pg.content())

        check("UIにページ例外なし", len(perr) == 0, f"errors={perr[:2]}")
        b.close()

    # ---- 集計 ----
    passed = sum(1 for r in results if r)
    total = len(results)
    print(f"\n==== E2E: {passed}/{total} passed ====")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
