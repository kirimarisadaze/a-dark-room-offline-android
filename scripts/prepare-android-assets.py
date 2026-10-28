#!/usr/bin/env python3
"""Build the Android game's local web bundle without changing upstream sources."""

import html
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "android/app/src/main/assets/game"


def prepare():
    # Only this generated directory is replaceable. Never delete source directories.
    expected = ROOT / "android/app/src/main/assets/game"
    if DEST.resolve() != expected.resolve() or not DEST.is_relative_to(ROOT):
        raise RuntimeError("Unexpected asset output directory")
    if DEST.exists():
        shutil.rmtree(DEST)
    DEST.mkdir(parents=True)
    for name in ("css", "img", "lib", "script", "audio"):
        shutil.copytree(ROOT / name, DEST / name,
                        ignore=shutil.ignore_patterns(".DS_Store", "Thumbs.db", "*.pyc"))
    (DEST / "lang").mkdir()
    shutil.copytree(ROOT / "lang/zh_cn", DEST / "lang/zh_cn")
    (DEST / "lang/langs.js").write_text("var langs = {'zh_cn': '简体中文'};\n", encoding="utf-8")
    for name in ("favicon.ico", "LICENSE.md"):
        shutil.copy2(ROOT / name, DEST / name)
    # Native's ES5 bootstrap reports unsupported WebViews/storage before game files.
    # Keep loading diagnostics, but never initialize or alter a save in that state.
    engine_path = DEST / "script/engine.js"
    engine = engine_path.read_text(encoding="utf-8")
    engine, count = re.subn(r'\$\(function\(\) \{\s*Engine\.init\(\);\s*\}\);',
                            '$(function() {\n  if (!window.__ADR_BOOT_ERROR) Engine.init();\n});',
                            engine)
    if count != 1:
        raise RuntimeError("Upstream Engine.init ready callback changed; inspect native startup guard")
    engine_path.write_text(engine, encoding="utf-8", newline="\n")
    button_path = DEST / "script/Button.js"
    button = button_path.read_text(encoding="utf-8")
    button, count = re.subn(r'if \(Engine\.options\.doubleTime\)\{\s*time /= 2;\s*\}',
                            'time /= Engine.getSpeed();', button)
    if count != 1:
        raise RuntimeError("Upstream cooldown speed logic changed; inspect speed adaptation")
    button_path.write_text(button, encoding="utf-8", newline="\n")
    events_path = DEST / "script/events.js"
    events = events_path.read_text(encoding="utf-8")
    for original, adapted in [
        ("Events._dotTimer = setInterval(", "Events._dotTimer = Engine.setInterval("),
        ("setTimeout(() => enemy.data('stunned', false), Events.STUN_DURATION)",
         "Engine.setTimeout(() => enemy.data('stunned', false), Events.STUN_DURATION)"),
    ]:
        if events.count(original) != 1:
            raise RuntimeError("Upstream combat duration logic changed; inspect speed adaptation")
        events = events.replace(original, adapted)
    events_path.write_text(events, encoding="utf-8", newline="\n")
    # Some upstream translations need no overrides and omit this optional file.
    # The common language loader still requests it, so provide a local empty sheet.
    for translation in (DEST / "lang").iterdir():
        if translation.is_dir() and (translation / "strings.js").is_file() and not (translation / "main.css").exists():
            (translation / "main.css").write_text("/* This language uses the shared game styles. */\n", encoding="utf-8")
    source = (ROOT / "index.html").read_text(encoding="utf-8")
    # Pointer events in offline.js own scene navigation. The legacy move plugin
    # installs document-wide touch listeners even after swipe handlers are removed.
    for legacy_gesture in ("jquery.event.move.js", "jquery.event.swipe.js"):
        source, count = re.subn(r'\s*<script\s+src="lib/' + re.escape(legacy_gesture) + r'"></script>', '', source)
        if count != 1:
            raise RuntimeError("Upstream gesture loader changed; inspect native touch handling")
    source, count = re.subn(
        r'<script src="https://ajax\.googleapis\.com/[^\"]+"></script>\s*'
        r'<script>\s*if\(!window\.jQuery\)\s*\{.*?</script>',
        '<script src="lib/jquery.min.js"></script>', source, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError("Upstream jQuery loader changed; inspect offline bundling")
    source, count = re.subn(r'\s*<!-- Google tag \(gtag\.js\) -->.*?gtag\(\x27config\x27,.*?</script>',
                            "", source, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError("Upstream analytics block changed; inspect offline bundling")
    source, count = re.subn(r'<script>\s*// try to read "lang" param\x27s from url.*?</script>',
        '<script>var lang = "zh_cn"; try { localStorage.lang = lang; } catch(e) {}</script>\n'
        '<script src="lang/zh_cn/strings.js"></script>\n'
        '<script src="zh-cn-extra.js"></script>\n'
        '<link rel="stylesheet" href="lang/zh_cn/main.css"/>', source, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError("Upstream language loader changed; inspect Chinese-only bundling")
    # Upstream StateManager uses eval for its existing dotted state paths.
    policy = ("default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
              "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
              "font-src 'self'; media-src 'self' blob:; connect-src 'self'; "
              "object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'")
    source = source.replace('<meta charset="UTF-8"/>', '<meta charset="UTF-8"/>\n'
                            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>\n'
                            '<meta name="referrer" content="no-referrer"/>\n'
                            f'<meta http-equiv="Content-Security-Policy" content="{policy}"/>')
    source = source.replace('</head>', '<link rel="stylesheet" href="mobile.css"/>\n'
                            '<script src="save-slots.js"></script>\n'
                            '<script src="offline.js"></script>\n</head>')
    # The publisher's decorative logo remains as attribution, without a dead external link.
    source = source.replace('href="https://www.doublespeakgames.com"', 'href="about.html"')
    source = source.replace('target="_blank"', '')
    (DEST / "index.html").write_text(source, encoding="utf-8", newline="\n")
    for name in ("offline.js", "mobile.css", "zh-cn-extra.js"):
        shutil.copy2(ROOT / "android/web" / name, DEST / name)
    for name in ("home.html", "home.css", "home.js", "save-slots.js"):
        shutil.copy2(ROOT / "android/web" / name, DEST / name)
    license_text = html.escape((ROOT / "LICENSE.md").read_text(encoding="utf-8"))
    notice_path = ROOT / "android/UPSTREAM.md"
    notice = notice_path.read_text(encoding="utf-8") if notice_path.exists() else (
        "A Dark Room by Michael Townsend / doublespeak games and contributors.\n"
        "Source: https://github.com/doublespeakgames/adarkroom\n"
        "Unofficial offline Android package. Web source files are included in this APK's assets/game directory.\n"
        "Android additions are provided with this project's source.\n")
    (DEST / "about.html").write_text(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>关于小黑屋</title><script src="save-slots.js"></script><style>'
        'body{font:16px/1.65 system-ui;margin:24px;max-width:900px}pre{white-space:pre-wrap;overflow-wrap:anywhere}'
        'a{color:inherit}a:first-child{display:inline-block;padding:12px 0}'
        '</style><a id="about-return" href="index.html">← 返回游戏</a>'
        '<script>if(location.search==="?from=home"){var a=document.getElementById("about-return");'
        'a.href="home.html";a.textContent="← 返回主页面";}</script>'
        '<h1>小黑屋 · 离线中文版</h1><pre>' + html.escape(notice) + '</pre>'
        '<h2>Mozilla Public License 2.0</h2><pre>' + license_text + '</pre></html>',
        encoding="utf-8")
    files = [p for p in DEST.rglob("*") if p.is_file()]
    print(f"Prepared {len(files)} local assets ({sum(p.stat().st_size for p in files):,} bytes) in {DEST}")


if __name__ == "__main__":
    prepare()
