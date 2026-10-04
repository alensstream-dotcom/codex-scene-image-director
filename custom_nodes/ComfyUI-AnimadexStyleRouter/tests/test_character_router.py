import importlib.util
import json
from pathlib import Path
import sys
import unittest


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "animadex_character_router_test_package", PACKAGE_ROOT / "__init__.py",
    submodule_search_locations=[str(PACKAGE_ROOT)],
)
package = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = package
SPEC.loader.exec_module(package)
character = sys.modules[SPEC.name + ".character_router"]


class CharacterRouterTests(unittest.TestCase):
    def test_exact_nilou_case_insensitive_marker_enables_tested_file(self):
        clean, name, strength, report = character.route_character_prompt(
            "@CHARACTER:nIlOu, nilou genshin, red hair, adult woman"
        )
        self.assertEqual(clean, "nilou genshin, red hair, adult woman")
        self.assertEqual(name, r"CodexAnima\Nilou-V2-E12.safetensors")
        self.assertEqual(strength, 0.4)
        self.assertFalse(json.loads(report)["trigger_injected"])

    def test_original_appearance_and_plain_character_trigger_do_not_enable_lora(self):
        for prompt in ("nilou genshin, red hair", "原创人物，红发绿眼，借鉴妮露的外貌", ""):
            with self.subTest(prompt=prompt):
                clean, name, strength, _ = character.route_character_prompt(prompt)
                self.assertEqual(clean, prompt)
                self.assertEqual(name, character.NILOU_LORA)
                self.assertEqual(strength, 0.0)

    def test_unknown_requests_and_path_injection_are_preserved_and_disabled(self):
        for marker in (
            "@character:Yor", "@character:Nilou/../../private.safetensors",
            r"@character:Nilou\..\private.safetensors", "@character:../../private",
            "@character:Nilou-other", "@character:Nilou..",
        ):
            with self.subTest(marker=marker):
                clean, name, strength, report = character.route_character_prompt(marker)
                self.assertEqual(clean, marker)
                self.assertEqual(name, character.NILOU_LORA)
                self.assertEqual(strength, 0.0)
                self.assertEqual(json.loads(report)["unsupported_markers_preserved"], 1)

    def test_last_character_request_disables_an_earlier_conflicting_nilou_request(self):
        clean, _, strength, _ = character.route_character_prompt(
            "@character:Nilou, nilou genshin, @character:Yor"
        )
        self.assertEqual(clean, "nilou genshin, @character:Yor")
        self.assertEqual(strength, 0.0)
        clean, _, strength, _ = character.route_character_prompt(
            "@character:Yor, @character:Nilou, nilou genshin"
        )
        self.assertEqual(clean, "@character:Yor, nilou genshin")
        self.assertEqual(strength, 0.4)

    def test_real_trigger_is_supplied_by_identity_not_injected_here(self):
        clean, _, strength, _ = character.route_character_prompt("@character:Nilou, full body")
        self.assertEqual(clean, "full body")
        self.assertNotIn("nilou genshin", clean)
        self.assertEqual(strength, 0.4)

    def test_style_and_weilin_tokens_are_unchanged(self):
        prompt = "@PC98, <lora:@character:Nilou:0.8>, <wlr>@character:Nilou</wlr>, woman"
        clean, _, strength, report = character.route_character_prompt(prompt)
        self.assertEqual(clean, prompt)
        self.assertEqual(strength, 0.0)
        self.assertEqual(json.loads(report)["supported_markers"], 0)

    def test_sentence_and_chinese_terminators_and_duplicate_requests(self):
        for prompt in ("@character:Nilou.", "@character:Nilou，", "@character:Nilou。", "@character:Nilou、"):
            with self.subTest(prompt=prompt):
                clean, _, strength, _ = character.route_character_prompt(prompt)
                self.assertEqual(clean, "")
                self.assertEqual(strength, 0.4)
        clean, _, strength, report = character.route_character_prompt(
            "@character:Nilou, nilou genshin\n@character:Nilou"
        )
        self.assertEqual(clean, "nilou genshin")
        self.assertEqual(strength, 0.4)
        self.assertEqual(json.loads(report)["supported_markers"], 2)

    def test_email_and_path_components_are_not_character_requests(self):
        prompt = "user@character:Nilou, https://example.com/@character:Nilou, prefix@character:Nilou"
        clean, _, strength, _ = character.route_character_prompt(prompt)
        self.assertEqual(clean, prompt)
        self.assertEqual(strength, 0.0)

    def test_registered_node_schema_and_existing_style_schema_are_exact(self):
        self.assertIs(package.NODE_CLASS_MAPPINGS["AnimadexCharacterRouter"], character.AnimadexCharacterRouter)
        node = character.AnimadexCharacterRouter()
        self.assertEqual(node.INPUT_TYPES(), {"required": {"prompt": ("STRING", {"multiline": True, "forceInput": True})}})
        self.assertEqual(node.RETURN_TYPES, ("STRING", "STRING", "FLOAT", "STRING"))
        self.assertEqual(node.RETURN_NAMES, ("clean_prompt", "lora_name", "strength", "report"))
        self.assertEqual(node.route("@character:Nilou"), character.route_character_prompt("@character:Nilou"))
        style = package.NODE_CLASS_MAPPINGS["AnimadexStyleRouter"]
        self.assertEqual(list(style.INPUT_TYPES()["required"]), ["prompt", "default_style"])
        self.assertEqual(style.RETURN_NAMES, ("clean_prompt", "lora_name", "strength", "report"))


if __name__ == "__main__":
    unittest.main()
