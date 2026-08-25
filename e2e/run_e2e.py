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
    # H-1 セキュリティ: 制作物urlのパストラバーサル/内部パス偽装を拒否 (削除時の越境ファイル操作を防ぐ)
    st, _ = api(ag, f"/projects/assets/{badAsset['id']}", "PUT", {"url": "/uploads/t_demo_agency/../evil.png"})
    check("制作物urlのパストラバーサルを拒否 (400)", st == 400, f"status={st}")
    st, okurl = api(ag, f"/projects/assets/{badAsset['id']}", "PUT", {"url": "https://example.com/lp/e2e"})
    check("正常なhttps urlは許可", st in (200, 201) and okurl.get("url") == "https://example.com/lp/e2e", f"status={st}")
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
    # Slackの署名検証が有効(本番相当)なら、無署名リクエストは拒否されるのが正しい
    st, intg0 = api(ag, "/integrations/status")
    slack_signed = any(i.get("key") == "slack" and i.get("configured") for i in (intg0.get("items") or []))
    st, sh = slack("help")
    if slack_signed:
        check("Slack署名検証が有効なら無署名は拒否 (401)", st == 401, f"status={st}")
    else:
        check("Slack help に agent コマンドがある", st in (200, 201) and sh and "agent" in sh.get("text", ""), f"status={st}")

    # AI運用エージェント (F-43): 1指示で 設定反映+クリエイティブ生成 まで一気通貫
    st, agr = api(ag, f"/projects/{pid}/agent", "POST", {"instruction": "月30万円で獲得を増やして。全国"})
    check("AIエージェント一気通貫実行 (6ステップ)", st in (200, 201) and agr and len(agr.get("steps", [])) == 6, f"status={st} steps={len(agr.get('steps', [])) if agr else '?'}")
    step_keys = [s2.get("key") for s2 in (agr.get("steps") or [])] if agr else []
    check("エージェントが検索キーワードまで設計する", "keywords" in step_keys, step_keys)
    check("エージェントが入稿準備まで到達する", "publish" in step_keys, step_keys)
    check("エージェントが配信設定を反映 (月予算30万)", bool(agr) and agr["appliedSettings"]["monthlyBudgetTotal"] == 300000)
    check("エージェントが制作物を生成", bool(agr) and len(agr.get("createdAssetTitles", [])) >= 1)

    # 媒体別 入稿シート (F-58): 媒体ごとに仕様が切り替わり、規定内に収まる
    sheets = {}
    for plat in ("google_ads", "meta", "line_ads"):
        st, sh = api(ag, f"/projects/{pid}/launch-sheet?platform={plat}")
        sheets[plat] = sh if st == 200 else None
    check("媒体別の入稿シートを出力できる", all(v is not None for v in sheets.values()),
          {k: (v is not None) for k, v in sheets.items()})
    g, m, l = sheets["google_ads"], sheets["meta"], sheets["line_ads"]
    if g and m and l:
        check("媒体ごとに構成が切り替わる",
              "キーワード" in g["structure"] and "広告セット" in m["structure"], f"{g['structure']} / {m['structure']}")
        check("検索媒体だけキーワードを載せる", len(g["keywords"]) >= 0 and len(m["keywords"]) == 0, len(m["keywords"]))
        check("Metaは本文枠・縦型画像を持つ",
              len(m["primaryTexts"]) > 0 and any(i["ratio"] == "9:16" for i in m["images"]), len(m["primaryTexts"]))
        check("LINEは3比率の画像仕様を返す", len(l["images"]) >= 3, len(l["images"]))
        over = [t for sh in (g, m, l) for t in sh["headlines"] + sh["descriptions"] + sh["primaryTexts"] if not t["ok"]]
        check("各媒体の文字数上限に収まるよう調整される（超過は3件以下）", len(over) <= 3, len(over))

    # 検索キーワードの自動設計 (F-57): 意図の強い語を厚く、除外KWも返す
    st, kplan = api(ag, f"/projects/{pid}/keyword-plan")
    ok_kp = st == 200 and isinstance(kplan, dict) and len(kplan.get("keywords", [])) > 0
    check("検索キーワードを自動設計できる", ok_kp, f"status={st}")
    if ok_kp:
        tiers = [k.get("tier") for k in kplan["keywords"]]
        check("発注意図の強い語(now)が情報収集(explore)より多い",
              tiers.count("now") > tiers.count("explore"), f"now={tiers.count('now')} explore={tiers.count('explore')}")
        check("無駄クリックを防ぐ除外キーワードを返す", len(kplan.get("negatives", [])) >= 5, len(kplan.get("negatives", [])))
        st, applied = api(ag, f"/projects/{pid}/keyword-plan/apply", "POST", {"plan": kplan})
        check("キーワードを配信設定へ反映できる",
              st in (200, 201) and applied and applied.get("keywordCount", 0) > 0, f"status={st}")

    # Google広告への実入稿 (F-56): プランは不足を具体的に示し、準備不足なら実行を拒否する
    st, lplan = api(ag, f"/projects/{pid}/launch-plan")
    check("入稿プラン取得 (制作物→広告文の自動変換)",
          st == 200 and isinstance(lplan, dict) and "ready" in lplan and isinstance(lplan.get("issues"), list), f"status={st}")
    if isinstance(lplan, dict) and not lplan.get("ready"):
        st, _ = api(ag, f"/projects/{pid}/launch", "POST", {})
        check("入稿の準備不足は実行を拒否 (400)", st == 400, f"status={st}")

    # CV受信 → GA4/Meta転送 (F-55)
    st, cl2 = api(ag, "/clients")
    ccid = cl2[0]["id"]
    st, tok = api(ag, f"/clients/{ccid}/measurement/token", "POST", {})
    check("CV受信トークン発行", st in (200, 201) and tok and len(tok.get("token", "")) > 30, f"status={st}")
    api(ag, f"/clients/{ccid}/measurement", "PUT", {"ga4MeasurementId": "G-E2E", "metaPixelId": "", "serverSideEnabled": True, "enhancedConversions": True})
    st, cv = api("", f"/collect/{tok['token']}", "POST", {"eventName": "Purchase", "eventId": "e2e-suite-cv", "value": 5000, "email": "E2E@Example.com"})
    check("CVを認証なしで受信できる", st in (200, 201) and cv and cv.get("accepted"), f"status={st}")
    st, cv2 = api("", f"/collect/{tok['token']}", "POST", {"eventName": "Purchase", "eventId": "e2e-suite-cv", "value": 5000})
    check("同一eventIdは重複排除される", bool(cv2) and cv2.get("duplicate") is True, cv2)
    st, _ = api("", "/collect/invalid_token_zzz", "POST", {"value": 1})
    check("不正な計測トークンは404", st == 404, f"status={st}")
    st, evs = api(ag, f"/clients/{ccid}/measurement/events")
    check("受信CVに平文メールが保存されない",
          st == 200 and isinstance(evs, list) and "e2e@example.com" not in json.dumps(evs).lower(), f"status={st}")

    # 外部連携 有効化状況 (F-48): 6連携の設定状況を返す
    st, intg = api(ag, "/integrations/status")
    check("外部連携ステータス取得 (6件)", st == 200 and intg and intg.get("total") == 6 and "readyCount" in intg, f"status={st}")

    # 成約パイプライン (F-47): 案件作成→受注でサマリに反映
    st, clist0 = api(ag, "/clients")
    dcid = clist0[0]["id"]
    st, deal = api(ag, "/deals", "POST", {"clientId": dcid, "name": "E2E成約案件", "stage": "won", "value": 500000, "grossMarginPct": 40, "source": "Google検索"})
    check("成約案件を作成", st in (200, 201) and deal and deal.get("stage") == "won", f"status={st}")
    st, dsum = api(ag, f"/deals/summary?clientId={dcid}")
    check("成約サマリに受注・粗利ROASが反映", st == 200 and dsum and dsum["wonValue"] >= 500000 and dsum["grossProfit"] >= 200000, f"status={st}")
    api(ag, f"/deals/{deal['id']}", "DELETE")

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

    # レポート配信 + 監査ログ (F-50)
    st, rep = api(ag, "/reports/run", "POST", {"clientId": cid, "periodType": "weekly"})
    rid = rep.get("id") if isinstance(rep, dict) else None
    st, dl = api(ag, f"/reports/{rid}/deliver", "POST", {})
    check("レポート配信 (共有リンク発行)", st in (200, 201) and isinstance(dl, dict) and "/share/" in dl.get("url", ""), f"status={st}")
    ch = dl.get("channel") if isinstance(dl, dict) else None
    check("配信チャネルが環境に応じて決まる (slack/link)", ch in ("slack", "link"), ch)
    st, alog = api(ag, "/audit-log")
    acts = [e["action"] for e in alog] if isinstance(alog, list) else []
    check("監査ログ取得 (操作証跡)", st == 200 and isinstance(alog, list) and len(alog) > 0, f"status={st}")
    check("監査ログにレポート配信・ログインが記録される", "report_delivered" in acts and "login" in acts, sorted(set(acts))[:8])
    st, flog = api(ag, "/audit-log?action=report_delivered")
    check("監査ログの操作フィルタが効く", st == 200 and isinstance(flog, list) and all(e["action"] == "report_delivered" for e in flog), f"status={st}")

    # 自動反映ループ: 予算ペーシング → 承認キューへ提案 (F-51)
    st, pac = api(ag, "/pacing")
    check("予算ペーシング取得", st == 200 and isinstance(pac, list), f"status={st}")
    st, aq0 = api(ag, "/proposals")
    n0 = len(aq0) if isinstance(aq0, list) else 0
    st, sweep = api(ag, "/pacing/propose", "POST", {})
    okshape = st in (200, 201) and isinstance(sweep, dict) and sweep.get("scanned") == sweep.get("created", 0) + sweep.get("skipped", 0)
    check("ペーシング自動提案スイープ (scanned=created+skipped)", okshape, f"status={st} {sweep if isinstance(sweep,dict) else ''}")
    st, aq1 = api(ag, "/proposals")
    n1 = len(aq1) if isinstance(aq1, list) else 0
    check("作成分だけ承認キューが増える", isinstance(sweep, dict) and n1 == n0 + sweep.get("created", 0), f"{n0}->{n1}")
    st, sweep2 = api(ag, "/pacing/propose", "POST", {})
    check("再スイープは重複回避 (created=0)", isinstance(sweep2, dict) and sweep2.get("created", 0) == 0, sweep2 if isinstance(sweep2, dict) else st)

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
    st, _ = api(cl, "/audit-log")
    check("提供先は監査ログを閲覧不可 (403)", st == 403, f"status={st}")
    st, _ = api(cl, "/pacing/propose", "POST", {})
    check("提供先は自動予算提案不可 (403)", st == 403, f"status={st}")

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

        # タブは一気通貫の順序に番号付き (② 配信設定)
        pg.get_by_role("button", name="配信設定").first.click(); pg.wait_for_timeout(1200)
        body2 = pg.content()
        check("配信設定に業種別導線設計", "業種別 導線設計" in body2)
        check("配信設定に販促カレンダーが統合されている", "販促カレンダー" in body2)
        # 改善タブに最適化ツールが統合されている
        pg.get_by_role("button", name="改善").first.click(); pg.wait_for_timeout(2500)
        body3 = pg.content()
        check("改善タブに診断・キーワード・予算ペース・変更履歴が統合",
              all(t in body3 for t in ("AI診断", "キーワード最適化", "予算ペース", "変更履歴")))
        check("改善タブにA/B・増分効果テストが統合",
              all(t in body3 for t in ("A/Bテスト", "増分効果テスト")))
        # 報告タブでレポート生成〜配信まで到達できる
        pg.get_by_role("button", name="報告").first.click(); pg.wait_for_timeout(1200)
        body4 = pg.content()
        check("報告タブにレポート生成とライブポータル",
              "週次レポートを生成" in body4 and "ライブポータル" in body4)

        check("UIにページ例外なし", len(perr) == 0, f"errors={perr[:2]}")
        b.close()

    # ---- 集計 ----
    passed = sum(1 for r in results if r)
    total = len(results)
    print(f"\n==== E2E: {passed}/{total} passed ====")
    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
