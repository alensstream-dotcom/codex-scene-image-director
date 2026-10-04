"""Animadex preprocessing rules, created 2026-09-30. No model/API required.

Tag translations and optional source-tree hints are separately attributed to
st-chatu8; classification rules here are explicit, inspectable local rules.
"""
import re

VERSION = "1.0.0"

def normalize(text):
    return re.sub(r"\s+", " ", str(text).lower().replace("_", " ")).strip()

COLORS = {"aqua", "black", "blonde", "blue", "brown", "dark blue", "dark brown",
          "dark green", "dark purple", "green", "grey", "gray", "light blue",
          "light brown", "light green", "light purple", "orange", "pink", "purple",
          "red", "silver", "white", "yellow", "gold", "rainbow", "dark red", "platinum blonde"}
HAIR_LENGTHS = ["very short", "short", "medium", "long", "very long", "absurdly long"]
LABEL_OVERRIDES = {
    "android": "人造人", "habit": "修女服", "horse tail": "马的尾巴",
    "1girl": "女性单人标签", "1boy": "男性单人标签", "1other": "性别未定单人标签",
    "no humans": "非人类", "aqua hair": "青色头发", "aqua eyes": "青色眼睛",
    "grey hair": "灰色头发", "grey eyes": "灰色眼睛", "medium hair": "中长发",
    "virtual youtuber": "虚拟主播", "skin fang": "皮肤色尖牙画法",
}
FACET_LABELS = {
    "gender": "性别标签", "age_evidence": "原始年龄描述（非核实年龄）", "species": "种族与形态",
    "hair_color": "发色", "hair_length": "发长", "hair_pattern": "多色头发模式",
    "hair_style": "发型", "bangs": "刘海", "eye_color": "瞳色", "eye_features": "眼部特征",
    "skin": "肤色与皮肤", "build": "体型", "bust": "胸部体型", "ears": "耳部",
    "horns": "角", "tail": "尾巴", "wings": "翅膀", "face": "面部", "marks": "固定标记",
    "anatomy": "其他身体特征", "facial_hair": "胡须", "top": "上衣", "bottom": "下装",
    "full_body": "连体服装", "outerwear": "外套披风", "footwear": "鞋靴", "legwear": "袜与腿饰",
    "gloves": "手套", "headwear": "帽与头饰", "armor": "护甲", "underwear": "内衣",
    "swimwear": "泳装", "style": "服装类型", "details": "服装细节", "material": "材质",
    "pattern": "花纹", "condition": "衣服状态", "hair_accessory": "发饰", "eyewear": "眼镜",
    "jewelry": "首饰", "neckwear": "颈饰", "accessory": "其他配饰", "makeup": "妆容",
    "expression": "表情", "action": "动作", "pose": "姿势", "prop": "道具", "scene": "场景",
    "composition": "构图", "rendering": "画面风格", "reference": "作品与命名参照",
    "exposure": "身体裸露描述", "sensitive": "亲密与敏感内容", "count": "人数描述",
    "other": "保留但未归类",
}

def result(section, facet, value=None, rule="explicit-v1"):
    return {"section": section, "facet": facet, "value": value, "rule": rule}

def classify(t, hints=()):
    """Exactly one primary category; all source tags remain available separately."""
    # Audited additions precede substring rules, keeping objects/poses out of identity.
    extensions = [
        ("metadata","reference",r"^(?:official alternate .+|alternate .+|mega pokemon|shiny pokemon|clothed pokemon|gigantamax|tokusatsu|utaite|voice actor|character name|u\.n\. spacy|zeon|autobot|decepticon|gold saint|material growth|genderswap.*)$"),
        ("metadata","rendering",r"^(?:bara|bishounen|chibi|convenient censoring|dated)$"),
        ("context","exposure",r"^(?:stomach|off shoulder|zettai ryouiki|single bare .+|bare .+|breast curtains?|bodypaint|body writing|linea alba)$"),
        ("context","expression",r"^(?:anger vein|drooling|pursed lips|raised eyebrows|runny nose|saliva|snot|sweatdrop|flying sweatdrops|sweatdrops|breath|blood from mouth|blood on .+|blood|wet|glowing|sparkle|steaming body|blush stickers)$"),
        ("context","sensitive",r"^(?:hetero|shibari.*|bound arms|bound legs)$"),
        ("context","pose",r"^(?:arm (?:across|around|under).+|arms across .+|hands up|clenched hands|foot dangle|presenting foot|on head|nail biting|hair spread out|floating hair|covered .+|soaking feet|tickling feet)$"),
        ("context","prop",r"\b(?:stuffed|plush|toy|puppet|quiver|id card|innertube|kunai|shuriken|ankh|cigar|rapier|anchor|drone|lightsaber|polearm|kiseru|tantou|torpedo|baseball bat|beachball|cube|flute|holster|mirror|scope|talisman|chainsaw|greatsword|remington arms|spiked club|head-mounted display|head mirror|hand fan|pacifier|fish bottle|grilled fish)\b"),
        ("context","prop",r"\b(?:on head|on shoulder|on arm|around neck|shadow puppet|on hand|skull on|object through|object on|leaf on|bucket on|mushroom on|towel on|bird skull|animal skull|dragon ball \(object\))\b"),
        ("context","scene",r"^(?:heart|spikes|pentagram|spider web|yin yang|spike)$"),
        ("metadata","composition",r"^(?:speech bubble|couple|extra|mini person)$"),
        ("accessory","makeup",r"\b(?:mascara|toenail polish|nail art|fake nails)\b|^(?:aqua|black|blue|brown|green|grey|orange|pink|purple|red|white|yellow|multicolored) (?:lips|nails)$"),
        ("accessory","accessory",r"\b(?:bandaid|chin strap|forehead protector|mouth veil|forehead jewel|forehead gem|clown nose|respirator|lanyard|name tag|insignia|medal|bindi|magatama|earclip|head wreath|plume|beads|dog tags|sticker on face|shimenawa|head ornament|hair comb|cowbell)\b"),
        ("accessory","hair_accessory",r"\b(?:bun cover|scrunchie|kanzashi)\b"),
        ("accessory","neckwear",r"\bfeather boa\b"),
        ("outfit","headwear",r"\b(?:beanie|fedora|ushanka|tate eboshi|qingdai guanmao|deerstalker|tall hat|animal helmet)\b"),
        ("outfit","top",r"\b(?:bandeau|chest guard|chest wrap)\b"),
        ("outfit","bottom",r"\b(?:sarong|buruma)\b"),
        ("outfit","full_body",r"\b(?:spacesuit|plugsuit|surcoat|kesa|wetsuit)\b"),
        ("outfit","outerwear",r"\b(?:shawl|stole|coattails)\b"),
        ("outfit","style",r"^(?:playboy bunny|gakuran|kogal|policewoman|bride|clown|jester|wizard|valkyrie|jirai kei|fairy kei)$"),
        ("outfit","details",r"\b(?:skindentation|skin tight|center opening|hip vent|shoulder pads|sode|thighlet|crotch seam|shoulder spikes|keyhole|elbow pads|arm guards|arm wrap|leg wrap|hand wraps|hadanugi dousa|leg warmers|chest jewel|arm sling)\b"),
        ("outfit","armor",r"\b(?:gambeson|crotch plate|boobplate)\b"),
        ("appearance","hair_style",r"\b(?:half updo|single side bun|blunt ends|braided bun|single sidelock|cowlick|pompadour|inverted bob|short sidetail|side drill|sidecut|flattop|wolf cut)\b"),
        ("appearance","facial_hair",r"\b(?:facial hair|mutton chops|sideburns stubble|whiskers)\b"),
        ("appearance","anatomy",r"\b(?:body hair|arm hair|armpit hair|chest hair|hand hair|leg hair|stomach hair|hairy|toes|soles|veins|obliques|fewer digits|blowhole|colored extremities|digitigrade|robot joints|doll joints|animal hands|animal feet|animal head|bird legs|dragon claw|wolf paws|dog paws|cat paws|skull|talons|suction cups)\b"),
        ("appearance","marks",r"\b(?:stitched face|hair tattoo|command spell|forehead mark)\b"),
        ("appearance","build",r"^(?:manly|shortstack)$"),
        ("appearance","eye_features",r"^(?:blind|sharingan)$"),
        ("demographic","age_evidence",r"^oppai loli$"),
        ("demographic","species",r"^(?:ghost|erune|draph|zombie|au ra|miqo'te|harvin|hyur|yordle|cyclops|elezen|jiangshi|nekomata|eldritch abomination|shikigami|viera|centauroid)$"),
        ("demographic","species",r"^(?:(?:mouse|tiger|sheep|bear|lion|arthropod|squirrel|shark|deer|plant|goat|moth|cow|bat|weasel|leopard|orca) (?:girl|boy)|butterfly|ferret|jellyfish|starfish|bug|octopus|dinosaur|duck|frog|monkey|pig|crab|hedgehog|lion|puppy|eagle|unicorn|weasel|moth|shark|shiba inu|turtle|sheep|goldfish|white snake|blue butterfly|bald eagle)$"),
    ]
    for section,facet,pattern in extensions:
        if re.search(pattern,t): return result(section,facet,t,"audited-additions-v1")
    additions = [
        ("metadata","reference",r"^(?:duel monster|native american|imperial japanese army|jedi|netnavi|shinsengumi|twitter username|nt-d|meme|siblings|squidbeak splatoon|ainu|chiester sisters|animification|jimiko|tour guide)$"),
        ("context","prop",r"\b(?:revolver|randoseru|bolt action|h&k hk416|m4 carbine|p90|sheath|wine glass|beer|card|chewing gum|clock|dice|family crest|four-leaf clover|hose|missile pod|naginata|padlock|pump action|roundel|sakazuki|screw|spray can|television|treble clef|tuanshan|boomerang|broom|conductor baton|desk|statue)\b"),
        ("context","action",r"^(?:sheathed|framed breasts|bursting breasts|unaligned breasts|inconvenient breasts|between breasts|fang out|mouth covered|covered mouth|dirty face|dirty feet|chocolate on hand|blood on mouth|bruise on face|nail biting|eyebrows hidden by hair|eyes visible through hair|hair through headwear|hair through hood|hair over breasts|hair over shoulder)$"),
        ("context","exposure",r"^(?:thigh gap|shoulder blades|sidepec)$"),
        ("appearance","anatomy",r"\b(?:turtle shell|pelt|prosthesis|stitched torso|thrusters|oversized forearms|very long fingernails|bone|chest tuft)\b"),
        ("appearance","eye_features",r"^aegyo sal$"),
        ("appearance","hair_style",r"\b(?:braided sidelock|quad drills|beehive hairdo)\b"),
        ("accessory","neckwear",r"\b(?:cross tie|bolo tie)\b"),
        ("accessory","accessory",r"\b(?:obijime|earpiece|scouter|tasuki|shoulder boards)\b"),
        ("outfit","headwear",r"\b(?:tricorne|ajirogasa|jingasa|sandogasa)\b"),
        ("outfit","outerwear",r"^straitjacket$"),
        ("outfit","footwear",r"^inline skates$"),
        ("outfit","style",r"^(?:magical boy|butler)$"),
        ("metadata","composition",r"^(?:!\?|2koma|triangle|star of david)$"),
        ("context","scene",r"^(?:rock|constellation)$"),
        ("demographic","species",r"^(?:blob|slug|spider|squid|wyvern|dullahan|enpera|gerudo|hume|lalafell|rito|slime boy|spirit|undead|white tiger|yuki onna|calico|clownfish|creature and personification|(?:hyena|owl|penguin|red panda|monkey|pig|snake|cockroach) girl)$"),
    ]
    for section,facet,pattern in additions:
        if re.search(pattern,t): return result(section,facet,t,"audited-additions-v1")
    # Scene/interaction and removable objects must precede anatomy substring rules.
    if re.match(r"^(?:\d+girls?|\d+boys?|\d+others?|multiple (?:girls|boys|others)|solo|solo focus)$", t):
        if t in {"1girl", "1boy", "1other"}:
            return result("demographic", "gender", {"1girl":"female","1boy":"male","1other":"ambiguous"}[t])
        return result("metadata", "count")
    if t == "no humans": return result("demographic", "species", "nonhuman")
    if t in {"ambiguous gender", "androgynous"}: return result("demographic", "gender", "ambiguous")
    if t in {"child", "baby", "toddler", "teenage", "mature female", "mature male", "old man", "old woman", "loli", "shota", "aged up", "aged down"}:
        return result("demographic", "age_evidence", t)
    if re.search(r"\b(?:sex|sexual|orgasm|ejaculation|cum|semen|penetration|masturbation|fellatio|cunnilingus|fingering|tentacle sex|nipple|nipples|penis|pussy|vagina|anus|testicles|areola|areolae|erection|nude|naked|nudity|topless|bottomless|bondage|bdsm|chastity|crotch tattoo|pubic|ass focus)\b", t):
        return result("context", "sensitive")
    if re.match(r"^(?:holding|carrying|grabbing|pulling|lifting|adjusting|removing|putting on|covering|touching|biting|licking|hugging|kissing|sitting|standing|kneeling|crouching|lying|leaning|walking|running|jumping|dancing|fighting|aiming|pointing|waving|saluting|looking|reaching|stretching|riding|playing|eating|drinking|shooting|drawing|writing|reading|sleeping|crying)\b", t):
        return result("context", "action")
    if re.search(r"\b(?:shirt lift|skirt lift|dress lift|clothes lift|pants down|skirt tug|dress tug|sleeves rolled up|unzipped|unbuttoned|open clothes|torn clothes|wet clothes|clothing aside|breasts out|breasts apart|bouncing breasts)\b", t):
        return result("outfit", "condition")
    if re.search(r"\b(?:cleavage|midriff|navel|bare shoulders|bare arms|bare legs|bare back|underboob|sideboob|breasts out|ass|armpits|thighs|collarbone|pectoral cleavage|groin|cameltoe)\b", t) and not re.search(r"\b(?:cutout|tattoo|mole|scar)\b", t):
        return result("context", "exposure")
    # Make-up / ornaments are mutable, even when frequently associated with a character.
    if re.search(r"\b(?:eyeshadow|lipstick|makeup|nail polish|painted nails|facepaint|face paint|eyeliner|rouge)\b", t):
        return result("accessory", "makeup")
    if re.search(r"\b(?:glasses|eyewear|sunglasses|monocle|goggles)\b", t):
        return result("accessory", "eyewear")
    if re.search(r"\b(?:hair ornament|hair ornaments|hair bow|hair bows|hair ribbon|hair ribbons|hair flower|hair flowers|hair bell|hair beads|hairclip|hairclips|hair clip|hair clips|hairpin|hairpins|hair stick|hair sticks|hairband|hair scrunchie|hair tie|hair bobbles|hair rings|hair tubes|hair bun cover|hair intakes accessory)\b", t):
        return result("accessory", "hair_accessory")
    if re.search(r"\b(?:earrings?|ear piercing|ear piercings|ear ornament|necklace|choker|bracelet|bangle|jewelry|brooch|pendant|locket|nose ring|piercing|piercings|anklet|finger ring|rings|ring)\b", t) and not re.search(r"\b(?:ringed|ringlets|ring of|ring finger)\b", t):
        return result("accessory", "jewelry")
    if re.search(r"\b(?:necktie|bowtie|bow tie|scarf|scarves|neckerchief|neck ribbon|neck bow|cravat|ascot|neck bell|collar|neck ruff)\b", t) and not re.search(r"\b(?:shirt|dress|jacket|coat|bone|cutout|fur-trimmed|sailor|frilled)\b", t):
        return result("accessory", "neckwear")
    if re.search(r"\b(?:fake animal ears|fake horns|fake tail|fake wings|headphones|earphones|ear covers|mask|masks|eyepatch|eye patch|blindfold|bandages|bandaged|mouth mask|surgical mask|headset|head microphone|armband|ribbon|bow|bows|bell|bells|belt|belts|suspenders|sash|obi|badge|badges|pin|pins|buckle|buckles|wristband|wristbands|cuffs|handcuffs|ankle ribbon|leg ribbon|pouch|bag|backpack|handbag|umbrella)\b", t) and t not in {"bow (weapon)", "bow", "ribbon trim", "bow-shaped pupils"}:
        return result("accessory", "accessory")
    if t == "bow": return result("accessory", "accessory")
    # Atomic discriminating features.
    if t.endswith(" hair") and t[:-5] in COLORS:
        return result("appearance", "hair_color", t[:-5].replace("gray", "grey"))
    if t in {x+" hair" for x in HAIR_LENGTHS}:
        return result("appearance", "hair_length", t[:-5])
    if t in {"multicolored hair", "two-tone hair", "split-color hair", "gradient hair", "streaked hair", "colored inner hair", "colored tips", "dip-dyed hair", "hair streak", "rainbow hair"}:
        return result("appearance", "hair_pattern", t)
    if t.endswith(" eyes") and t[:-5] in COLORS:
        return result("appearance", "eye_color", t[:-5].replace("gray", "grey"))
    if re.search(r"\b(?:pupils?|heterochromia|eyelashes|eyes|eye|sclera|eyelids?|tsurime|tareme)\b", t) and not re.search(r"\b(?:hair|bandage|patch|closed|closing|winking|half-closed|looking|rolling|tears|tear)\b", t):
        return result("appearance", "eye_features", t)
    if "bangs" in t or t in {"hair between eyes", "hair over one eye", "hair over eyes", "hair intakes", "sidelocks", "asymmetrical sidelocks"}:
        return result("appearance", "bangs", t)
    if re.search(r"\b(?:hair|ahoge|twintails|ponytail|ponytails|braids?|dreadlocks|cornrows|afro|bald|balding|buzz cut|pixie cut|bob cut|hime cut|mohawk|undercut|crew cut|bowl cut|ringlets|mullet|chignon|sidelocks|sideburns|hair bun|hair buns|twin drills|one side up|two side up)\b", t):
        return result("appearance", "hair_style", t)
    if re.search(r"\b(?:beard|mustache|moustache|stubble|goatee|facial hair|chin beard)\b", t):
        return result("appearance", "facial_hair", t)
    if re.search(r"\b(?:ears?|ear fluff|ear tufts)\b", t): return result("appearance", "ears", t)
    if re.search(r"\b(?:horns?|antlers)\b", t): return result("appearance", "horns", t)
    if re.search(r"\b(?:tails?|tail fin|tail fins)\b", t) or t=="fins": return result("appearance", "tail", t)
    if re.search(r"\b(?:wings?|winged arms|wing ears)\b", t): return result("appearance", "wings", t)
    if re.search(r"\b(?:skin|dark-skinned female|dark-skinned male|tan|tanned|tanlines|scales|fur|feathers|carapace|exoskeleton)\b", t) and not re.search(r"\b(?:trim|trimmed|collar|coat|jacket|shirt|sleeves|dress|cuffs|hat|boots|skirt|skin tight|skin fang|skin fangs)\b", t):
        return result("appearance", "skin", t)
    if re.search(r"\b(?:mole|moles|scar|scars|tattoo|tattoos|freckles|birthmark|birthmarks|stitches|facial mark|facial markings|body markings|barcode)\b", t):
        return result("appearance", "marks", t)
    if t in {"flat chest", "small breasts", "medium breasts", "large breasts", "huge breasts", "gigantic breasts"}:
        return result("appearance", "bust", t)
    if re.search(r"\b(?:muscular|muscles|abs|biceps|pectorals|tall|short stature|petite|slim|skinny|plump|chubby|fat|obese|wide hips|narrow waist|thick thighs|broad shoulders|athletic|toned|curvy|hourglass figure)\b", t) and not re.search(r"\b(?:jeans|leotard|hat|shirt|top|dress)\b",t):
        return result("appearance", "build", t)
    if re.search(r"\b(?:eyebrows|eyebrow|fangs?|teeth|tooth|lips|mouth|nose|snout|muzzle|beak|chin|cheekbones|forehead|face shape|round face|sharp face|skin fang|skin fangs)\b", t) and not re.search(r"\b(?:open|closed|smile|smiling|grin|parted|licking|biting|drool|tongue|pout|hand|finger|heart|covering)\b", t):
        return result("appearance", "face", t)
    if re.fullmatch(r"(?:(?:black|blue|grey|orange|pink|red|white|dark|blood|night|eastern|western|giant|mini|female|humanoid|non-humanoid|super|clothed|oversized|baby|half|snow|tropical|angora|friesian)[- ]+)?(?:elf|dwarf|orc|goblin|ogre|troll|demon|angel|fairy|vampire|werewolf|mermaid|lamia|centaur|harpy|succubus|oni|yousei|kemonomimi|kemono|monster girl|monster boy|monster|creature|furry|furry female|furry male|anthro|robot|android|cyborg|mecha|mobile suit|golem|slime girl|doll|alien|dragon|cat|dog|wolf|fox|rabbit|horse|bird|fish|insect|reptile|amphibian|animal|tengu|kitsune|tanuki|arachne|minotaur|humanoid)(?: (?:girl|boy))?(?: \([^)]*\))?", t) or re.fullmatch(r"(?:pokemon|digimon|pal|pikmin|slime|elemental) \(creature\)",t):
        return result("demographic", "species", t)
    # Clothes slots: specific before generic. Qualified tags retain exact colors/details.
    if re.search(r"\b(?:hat|hats|cap|caps|beret|bonnet|helmet|helm|headwear|headdress|headgear|crown|tiara|diadem|visor|hood|hood down|hood up|veil|turban|bandana|headband|earmuffs|witch hat)\b", t):
        return result("outfit", "headwear", t)
    if re.search(r"\b(?:gloves|glove|gauntlets|gauntlet|mittens|mitten)\b", t): return result("outfit", "gloves", t)
    if re.search(r"\b(?:pantyhose|thighhighs|thigh highs|kneehighs|knee highs|socks|sock|stockings|stocking|legwarmers|leggings|legwear|tights|garter|garters|leg strap|leg straps)\b", t):
        return result("outfit", "legwear", t)
    if re.search(r"\b(?:shoes|shoe|boots|boot|sandals|sandal|sneakers|sneaker|loafers|slippers|slipper|high heels|stiletto heels|footwear|mary janes|get a|geta|zouri|uwabaki|moccasins|barefoot)\b", t):
        return result("outfit", "footwear", t)
    if re.search(r"\b(?:bra|bras|panties|underwear|lingerie|underpants|boxers|briefs|thong|g-string|pasties|negligee|nightgown|chemise|babydoll|fundoshi|sarashi|loincloth|chest wrap|jockstrap)\b", t):
        return result("outfit", "underwear", t)
    if re.search(r"\b(?:swimsuit|swimwear|bikini|monokini|micro bikini|swim trunks|swim briefs|one-piece swimsuit|rash guard)\b", t):
        return result("outfit", "swimwear", t)
    if re.search(r"\b(?:armor|armour|armored|breastplate|pauldron|pauldrons|greaves|vambraces|cuirass|chainmail|chain mail|gorget|faulds|leg armor|arm armor|shoulder armor)\b", t):
        return result("outfit", "armor", t)
    if re.search(r"\b(?:jacket|jackets|coat|coats|cape|capelet|cloak|cloaks|cardigan|poncho|mantle|haori|hanten|bolero|blazer|trench coat|overcoat|labcoat|lab coat)\b", t):
        return result("outfit", "outerwear", t)
    if re.search(r"\b(?:dress shirt|shirt|shirts|blouse|blouses|sweater|sweaters|hoodie|hoodies|t-shirt|t-shirts|tank top|crop top|tube top|halter top|camisole|bustier|corset|vest|vests|jersey|pullover|turtleneck|bodice|top|tops)\b", t) and not re.search(r"\b(?:top hat|top-heavy|topless|lowleg|highleg)\b", t):
        return result("outfit", "top", t)
    if re.search(r"\b(?:skirt|skirts|pants|pant|trousers|shorts|jeans|hakama|bloomers|culottes|jodhpur|jodhpurs|capri pants|short pants|petticoat)\b", t):
        return result("outfit", "bottom", t)
    if re.search(r"\b(?:dress|dresses|robe|robes|kimono|yukata|hanfu|qipao|china dress|cheongsam|bodysuit|leotard|unitard|jumpsuit|overalls|coveralls|romper|catsuit|zentai|habit|toga|sari|kigurumi|sundress|pajamas|nightdress|tunic)\b", t):
        return result("outfit", "full_body", t)
    if re.search(r"\b(?:uniform|serafuku|sailor uniform|maid|miko|nun|nurse|military|police|business suit|suit|tuxedo|formal|school|gym|sportswear|casual|traditional|gothic|lolita fashion|gothic lolita|wa lolita|punk|goth|steampunk|cyberpunk|victorian|chinese clothes|japanese clothes|russian clothes|indian clothes|korean clothes|hanbok|arabian clothes|magical girl|witch|ninja|pirate|knight|paladin|priest|shrine maiden|wrestling outfit|harem outfit|cheerleader|idol clothes|santa costume|bunny suit|sailor collar)\b", t):
        return result("outfit", "style", t)
    if re.search(r"\b(?:silk|satin|velvet|leather|latex|rubber|denim|lace|mesh|knit|knitted|ribbed|wool|transparent|see-through|sheer|fur trim|fur-trimmed|furry trim|feather-trimmed)\b", t):
        return result("outfit", "material", t)
    if re.search(r"\b(?:striped|stripes|plaid|checkered|argyle|polka dot|floral|camouflage|pattern|print|print clothes|dotted)\b", t):
        return result("outfit", "pattern", t)
    if re.search(r"\b(?:sleeves?|sleeveless|strapless|straps|strap|collared|collar|frills|frilled|ruffles|ruffled|button|buttons|zipper|zippers|pocket|pockets|lapels|lapel|hem|trim|cutout|cutouts|backless|off-shoulder|shoulder cutout|highleg|lowleg|side slit|slit|lacing|lace-up|clothes|clothing|outfit|garment|apron|epaulettes|epaulette|harness|armlet|armlets|arm warmers|wrist cuffs|detached collar|waist cape|tabard|pelvic curtain|thigh strap|thigh straps|sam browne belt|double-breasted)\b", t):
        return result("outfit", "details", t)
    if re.search(r"\b(?:smile|smiling|grin|grinning|blush|angry|frown|sad|happy|annoyed|expression|pout|pouting|closed eyes|half-closed eyes|winking|wink|tears|tear|cry|crying|sweat|drool|open mouth|closed mouth|parted lips|tongue|nervous|shy|surprised|scared|scowl|disgust|embarrassed|serious|expressionless|sleepy|tired|smirk|smug|disdain|blinking|raised eyebrows|furrowed brow|flustered|nose blush|light smile|evil smile)\b", t):
        return result("context", "expression")
    if re.search(r"\b(?:pose|hands? on|arms? up|arms? behind|arms? crossed|legs? up|legs? apart|crossed legs|outstretched|head tilt|spread legs|hand between|finger to|fingers to|one knee|on one knee|hand up|clenched hand)\b", t):
        return result("context", "pose")
    if re.search(r"\b(?:sword|swords|weapon|weapons|gun|guns|rifle|pistol|shotgun|cannon|axe|axes|dagger|daggers|knife|knives|scythe|spear|staff|shield|shields|book|books|pen|pencil|microphone|phone|cellphone|smartphone|camera|instrument|guitar|food|drink|cup|bottle|flower|flowers|plush|doll|teddy bear|lantern|wand|basket|hammer|brush|orb|gem|gemstone|coin|umbrella|ball|computer|laptop|key|keys|rope|chain|chains|cigarette|pipe|fruit|bread|cake|candy|pet|leash|symbol|flag|logos?|emblem)\b", t):
        return result("context", "prop")
    if re.search(r"\b(?:background|outdoors|indoors|sky|cloud|clouds|water|ocean|sea|beach|forest|trees|grass|snow|rain|city|street|room|bed|chair|table|wall|floor|window|building|castle|garden|night|day|sunset|sunrise|moon|sun|stars|fire|ice|magic circle|aura|lightning|smoke|fog|sparkles|floating)\b", t):
        return result("context", "scene")
    if re.search(r"\b(?:view|from behind|from above|from below|profile|portrait|upper body|full body|cowboy shot|close-up|cropped|focus|looking at viewer|dutch angle|perspective|foreshortening|facing|back|front|side view|multiple views|reference sheet|character sheet)\b", t):
        return result("metadata", "composition")
    if re.search(r"\b(?:official|alternate|virtual youtuber|copyright|cosplay|parody|crossover|remodel|form|costume|version|default|original|symbol|signature|watermark|english text|japanese text|artist name|text)\b", t) or "(" in t:
        return result("metadata", "reference")
    if re.search(r"\b(?:realistic|photorealistic|anime|manga|comic|sketch|painting|watercolor|monochrome|greyscale|sepia|lineart|pixel art|3d|render|cel shading|flat color|gradient|outline|sketch|chibi|stylized|low quality|high quality|best quality|scan|traditional media|digital media)\b", t):
        return result("metadata", "rendering")
    if re.search(r"\b(?:arms?|hands?|fingers?|legs?|feet|foot|claws?|nails|nail|hooves|hoof|tentacles|tentacle|antennae|halo|halos|head|heads|fins|fin|gills|joints|prosthetic|mechanical|robotic|extra limbs|amputee|limbs|flesh|skeleton|bones|bone|belly|navel|breasts|chest|tongue|abdominal|shoulders)\b", t):
        return result("appearance", "anatomy", t)
    # Source curated hierarchy is a fallback; never treat pose as personality.
    for group, sub in hints:
        if group == "服饰":
            smap = {"上衣":"top","外套":"outerwear","裙子":"bottom","裤子":"bottom","袜子":"legwear","鞋子":"footwear","靴子":"footwear","手套":"gloves","帽子":"headwear","头饰":"headwear","眼镜":"eyewear","首饰":"jewelry","耳饰":"jewelry","发饰":"hair_accessory","围巾":"neckwear","材质":"material","花纹":"pattern","盔甲":"armor","泳装":"swimwear","制服":"style","正装":"style","风格":"style","休闲装":"style","运动服":"style"}
            f=smap.get(sub,"condition" if sub.startswith("与") else "details")
            return result("accessory" if f in {"eyewear","jewelry","hair_accessory","neckwear"} else "outfit", f, t, "chatu8-tree-fallback-v1")
        if group == "人物":
            smap = {"头发":"hair_style","耳朵":"ears","眼睛":"eye_features","瞳孔":"eye_features","身材":"build","皮肤":"skin","面部":"face","脸型":"face","眉毛":"face","鼻子":"face","嘴巴":"face","牙齿":"face","翅膀":"wings","年龄":"age_evidence"}
            if sub in {"对象","身份","二次元角色"}: return result("metadata", "reference", t,"chatu8-tree-fallback-v1")
            f=smap.get(sub,"anatomy")
            return result("demographic" if f=="age_evidence" else "appearance",f,t,"chatu8-tree-fallback-v1")
        if group == "表情动作": return result("context","expression" if "表情" in sub or sub in {"笑","哭","不开心","蔑视","生气"} else "action",t,"chatu8-tree-fallback-v1")
        if group in {"场景","环境","魔法系"}: return result("context","scene",t,"chatu8-tree-fallback-v1")
        if group == "物品": return result("context","prop",t,"chatu8-tree-fallback-v1")
        if group == "镜头": return result("metadata","composition",t,"chatu8-tree-fallback-v1")
        if group == "画面": return result("metadata","rendering",t,"chatu8-tree-fallback-v1")
        if group == "汉服": return result("outfit","details",t,"chatu8-tree-fallback-v1")
    return result("other", "other", t, "unclassified-retained")

# Derived visual categories: explicit evidence only. These are not personalities.
ARCHETYPE_RULES = {
    "school_uniform": ("校服系", r"\b(?:school uniform|serafuku|sailor uniform)\b"),
    "maid": ("女仆装系", r"\bmaid\b"),
    "military": ("军装系", r"\b(?:military|army|naval|soldier uniform)\b"),
    "formal": ("正装系", r"\b(?:formal|business suit|suit|tuxedo|waistcoat)\b"),
    "armored": ("甲胄系", r"\b(?:armor|armored|breastplate|knight|paladin)\b"),
    "witch": ("魔女装系", r"\b(?:witch|witch hat)\b"),
    "magical_girl": ("魔法少女装系", r"\bmagical girl\b"),
    "shrine_maiden": ("巫女装系", r"\b(?:miko|shrine maiden)\b"),
    "religious": ("宗教服饰系", r"\b(?:nun|habit|priest|cassock)\b"),
    "traditional_japanese": ("日式传统服饰", r"\b(?:kimono|yukata|hakama|haori)\b"),
    "traditional_chinese": ("中式传统服饰", r"\b(?:hanfu|china dress|qipao|cheongsam|chinese clothes)\b"),
    "gothic": ("哥特服饰", r"\b(?:gothic|gothic lolita)\b"),
    "sporty": ("运动装系", r"\b(?:sportswear|gym uniform|track suit|tracksuit|jersey|tennis uniform)\b"),
    "idol": ("偶像装系", r"\b(?:idol clothes|idol costume|stage clothes)\b"),
    "medical": ("医疗服饰系", r"\b(?:nurse|lab coat|labcoat|doctor)\b"),
    "police": ("警服系", r"\bpolice\b"),
    "ninja": ("忍者服饰系", r"\bninja\b"),
    "fantasy_elf": ("精灵形象", r"\belf\b"),
    "animal_eared": ("兽耳形象", r"^(?:animal ears|cat ears|dog ears|fox ears|wolf ears|rabbit ears|horse ears|tiger ears|bear ears|cow ears|mouse ears)$"),
    "horned": ("有角形象", r"^(?:horns|demon horns|oni horns|antlers|ram horns|dragon horns)$"),
    "winged": ("有翼形象", r"^(?:wings|angel wings|demon wings|bat wings|feathered wings|fairy wings)$"),
    "mechanical": ("机械形象", r"^(?:robot|android|cyborg|mecha|mobile suit|mechanical arms|robot joints)$"),
}

def derive_archetypes(tags):
    return [{"id": aid, "label_zh": label, "evidence_tags": [t for t in tags if re.search(pattern,t)],
             "kind": "visual_evidence", "rule": "archetype-v1"}
            for aid,(label,pattern) in ARCHETYPE_RULES.items() if any(re.search(pattern,t) for t in tags)]
