#!/usr/bin/env python3
"""Génère les ressources visuelles brutes (art_raw/) via l'API d'images OpenAI.
Usage: python3 tools/gen_assets.py [filtre]   (ex: tex_ , tok_ , spr_)
La clé API est injectée par l'environnement ; aucune clé n'est stockée ici."""
import json, base64, sys, os, time, urllib.request, concurrent.futures as cf

OUT = os.path.join(os.path.dirname(__file__), "..", "art_raw")
os.makedirs(OUT, exist_ok=True)

STYLE_TEX = ("seamless tileable top-down satellite aerial photograph texture, ultra realistic, "
             "medieval fantasy world, perfectly even lighting from above, no shadows direction, no horizon, "
             "no objects, no text, uniform detail across the whole image, edges blend seamlessly. ")
TEXTURES = {
 "tex_grass": "lush green meadow seen from high altitude, patches of lighter and darker grass, tiny wildflowers, faint animal trails",
 "tex_forest": "dense temperate forest canopy seen from directly above, thousands of individual tree crowns of oak, beech and pine in deep greens with small gaps",
 "tex_rock": "rugged grey-brown mountain rock surface seen from above, cracked cliffs, scree, strata, sparse lichen",
 "tex_sand": "dry packed earth and sandy dirt with pebbles, ochre and beige, subtle cart ruts texture",
 "tex_water": "deep teal-blue lake water surface seen from above, gentle ripples, slight foam and light caustics",
}
STYLE_SPR = ("isolated object on fully transparent background, bird's-eye aerial view looking almost straight down, "
             "ultra realistic miniature-quality render, medieval fantasy, warm natural daylight, "
             "no ground plane, no cast shadow, no text, centered, entire object visible with margin. ")
SPRITES = {
 "spr_castle_a": "a large medieval stone castle with four round towers, curtain walls, inner keep and red banners",
 "spr_castle_b": "a fortified hilltop keep with a tall square tower, battlements and a small gatehouse, blue banners",
 "spr_village_a": "a small medieval village of about ten thatched-roof timber houses around a well, with small gardens and a dirt track",
 "spr_village_b": "a compact village with tiled red roofs, a small stone chapel and a market square",
 "spr_village_c": "a riverside hamlet of five wooden cottages with smoking chimneys and a haystack",
 "spr_ruins_a": "ancient overgrown stone ruins, broken walls and fallen columns with moss and ivy",
 "spr_ruins_b": "a ruined round watchtower collapsed on one side with scattered stones and ivy",
 "spr_tower": "a tall stone watchtower with a wooden roof, seen from above",
 "spr_windmill": "a wooden windmill with four sails and a small farm hut beside it",
 "spr_farm": "a medieval farmstead with a barn, a fenced yard, haystacks and a small field strip",
 "spr_camp": "a small adventurers' camp with three canvas tents, a campfire with embers and a few crates",
 "spr_stones": "a prehistoric standing stones circle with a central flat altar stone, lichen-covered",
 "spr_abbey": "a stone abbey with a cloister courtyard, a church with a cross-shaped roof and a bell tower",
 "spr_bridge": "a stone arch bridge crossing straight horizontally, with low parapets, seen from above",
 "spr_ship": "a medieval wooden sailing ship with a single square sail seen from above, sails slightly furled",
 "spr_caravan": "a horse-drawn covered merchant wagon with two horses, seen from above",
 "spr_knights": "a small troop of five knights on horseback riding in file, seen from above",
 "spr_dragon": "a majestic green dragon with wings spread wide, seen from above, flying",
 "spr_dais_a": "an ancient circular stone dais platform with concentric rings, carved glowing-less runes around the edge, flat top, weathered grey stone, a place to set a token",
 "spr_dais_b": "an ancient circular flagstone plaza with a ring of small carved stone pillars and runic engravings, flat, weathered",
}
STYLE_TOK = ("a single physical game token (a thick round medallion) photographed from slightly above, centered, "
             "isolated on fully transparent background, ultra realistic macro render, dramatic warm side lighting, "
             "thick beveled rim engraved with a ring of small runic glyphs, a raised circular central field, "
             "material: {mat}, the center is deeply engraved/carved with this emblem: {emblem}. "
             "No text letters other than runes, no hand, no table, no shadow beneath. ")
MATS = {
 "stone": "weathered dark grey granite with fine mineral speckles and tiny moss, rim engraved with pale runes",
 "wood": "aged dark oak wood with visible grain and a darker wax finish, rune carvings filled with faint amber",
 "metal": "antique hammered bronze/brass with verdigris in the crevices and polished edges, runes inlaid",
}
EMBLEMS = {
 "sword": "a medieval longsword crossed over a shield (combat, sport, discipline)",
 "book": "an open ancient book with a quill (knowledge, learning, studies)",
 "coin": "a stack of coins and a small treasure chest (wealth, savings, business)",
 "heart": "a heart entwined with a laurel branch (health, family, relationships)",
 "compass": "an old nautical compass rose with a sailing ship (travel, adventure, discovery)",
 "crown": "a royal crown above a mountain peak (career, ambition, leadership)",
 "flame": "a stylised bonfire flame with a lute (creativity, art, passion, music)",
 "tree": "a great oak tree with deep roots (nature, garden, long term growth)",
 "house": "a timber-framed house with a chimney and a key (home, building, property)",
 "gear": "an intricate clockwork cog with a hammer (craft, technology, projects)",
}

def jobs():
    j = []
    for k, v in TEXTURES.items():
        j.append((k, "gpt-image-1.5", STYLE_TEX + v, dict(quality="medium", size="1024x1024")))
    for k, v in SPRITES.items():
        j.append((k, "gpt-image-1.5", STYLE_SPR + v, dict(quality="medium", background="transparent", output_format="png", size="1024x1024")))
    for m, md in MATS.items():
        for e, ed in EMBLEMS.items():
            j.append((f"tok_{m}_{e}", "gpt-image-1.5", STYLE_TOK.format(mat=md, emblem=ed),
                      dict(quality="medium", background="transparent", output_format="png", size="1024x1024")))
    return j

def run(job):
    name, model, prompt, kw = job
    path = os.path.join(OUT, name + ".png")
    if os.path.exists(path):
        return name, "skip"
    for attempt in range(4):
        try:
            body = {"model": model, "prompt": prompt, "n": 1, **kw}
            req = urllib.request.Request("https://api.openai.com/v1/images/generations",
                data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
            r = json.load(urllib.request.urlopen(req, timeout=400))
            open(path, "wb").write(base64.b64decode(r["data"][0]["b64_json"]))
            return name, "ok"
        except Exception as e:
            err = str(e)
            if hasattr(e, "read"):
                try: err += e.read().decode()[:200]
                except Exception: pass
            time.sleep(5 * (attempt + 1))
    return name, "FAIL " + err

if __name__ == "__main__":
    flt = sys.argv[1] if len(sys.argv) > 1 else ""
    todo = [j for j in jobs() if flt in j[0]]
    print(len(todo), "images", flush=True)
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        for name, st in ex.map(run, todo):
            print(name, st, flush=True)
