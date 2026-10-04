import importlib.util
import json
from pathlib import Path
import sys
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "style_router.py"
SPEC = importlib.util.spec_from_file_location("animadex_style_router_test_module", MODULE_PATH)
router = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = router
SPEC.loader.exec_module(router)


class StyleRouterTests(unittest.TestCase):
    def test_last_recognized_marker_wins_and_obsolete_triggers_are_removed(self):
        prompt = "@mikkoani, yor briar, red eyes, @BlueArchive, full body, @PC98"
        clean, name, strength, report = router.route_prompt(prompt, "RDBT")
        self.assertEqual(name, router.PROFILES["PC98"].lora_name)
        self.assertEqual(strength, 0.35)
        self.assertEqual(clean, "pc98gal_style, yor briar, red eyes, full body")
        self.assertNotIn("mikkoani", clean)
        self.assertNotIn("BlueArchive", clean)
        self.assertEqual(json.loads(report)["recognized_markers"], 3)

    def test_selected_real_training_trigger_is_preserved_once(self):
        clean, name, strength, _ = router.route_prompt("@Mikko, @mikkoani, adult woman")
        self.assertEqual(clean, "@mikkoani, adult woman")
        self.assertEqual(name, r"CodexAnima\anima-mikkoani-v3.1.safetensors")
        self.assertEqual(strength, 0.55)
        clean, _, _, _ = router.route_prompt("@style:BlueArchStyle, yor briar")
        self.assertEqual(clean, "@BlueArchStyle, yor briar")

    def test_pc98_does_not_duplicate_an_existing_training_tag(self):
        clean, _, _, _ = router.route_prompt("pc98gal_style, adult woman, @style:pc98")
        self.assertEqual(clean, "pc98gal_style, adult woman")

    def test_unknown_markers_do_not_override_default_or_change_prose(self):
        prompt = "@UnknownArtist, The woman walks through the rain.\n@style:unlisted"
        clean, name, strength, report = router.route_prompt(prompt, "RDBT")
        self.assertEqual(clean, prompt)
        self.assertEqual(name, router.PROFILES["RDBT"].lora_name)
        self.assertEqual(strength, 0.85)
        self.assertEqual(json.loads(report)["unknown_markers_preserved"], 2)

    def test_path_injection_is_preserved_as_text_but_never_loaded(self):
        for attack in [
            "@style:../../private.safetensors",
            "@style:PC98/../../private.safetensors",
            r"@Mikko\..\private.safetensors",
            "@style:C:\\models\\private.safetensors",
            "@PC98-other",
        ]:
            with self.subTest(attack=attack):
                clean, name, strength, report = router.route_prompt(attack, "RDBT")
                self.assertEqual(clean, attack)
                self.assertEqual(name, router.PROFILES["RDBT"].lora_name)
                self.assertEqual(strength, 0.85)
                self.assertEqual(json.loads(report)["recognized_markers"], 0)

    def test_email_url_and_nonstandalone_words_are_not_controls(self):
        prompt = "user@mikkoani.com, https://example.com/@PC98, prefix@RDBT, @@BlueArchive"
        clean, _, _, report = router.route_prompt(prompt, "RDBT")
        self.assertEqual(clean, prompt)
        self.assertEqual(json.loads(report)["recognized_markers"], 0)

    def test_weilin_and_lora_tokens_are_opaque_even_with_known_aliases(self):
        prompt = "<lora:@Mikko:0.8>, <wlr @PC98>, <wlr>@BlueArchive</wlr>, @RDBT, woman"
        clean, name, _, report = router.route_prompt(prompt)
        self.assertEqual(clean, "<lora:@Mikko:0.8>, <wlr @PC98>, <wlr>@BlueArchive</wlr>, woman")
        self.assertEqual(name, router.PROFILES["RDBT"].lora_name)
        self.assertEqual(json.loads(report)["recognized_markers"], 1)

    def test_newlines_and_character_identity_triggers_survive(self):
        prompt = "@style:mIkKo, nilou genshin, yor briar\n1girl, red eyes, long black hair"
        clean, _, _, _ = router.route_prompt(prompt)
        self.assertEqual(clean, "@mikkoani, nilou genshin, yor briar\n1girl, red eyes, long black hair")

    def test_opaque_lora_content_does_not_suppress_the_real_training_trigger(self):
        clean, _, _, _ = router.route_prompt("<wlr>@mikkoani</wlr>, adult woman", "Mikko")
        self.assertEqual(clean, "@mikkoani, <wlr>@mikkoani</wlr>, adult woman")

    def test_single_sentence_period_is_supported_only_before_whitespace_or_end(self):
        clean, name, _, _ = router.route_prompt("beautiful adult woman, @PC98.", "RDBT")
        self.assertEqual(clean, "pc98gal_style, beautiful adult woman")
        self.assertEqual(name, router.PROFILES["PC98"].lora_name)
        clean, name, _, _ = router.route_prompt("@style:BlueArchive.\nyor briar", "RDBT")
        self.assertEqual(clean, "@BlueArchStyle, yor briar")
        self.assertEqual(name, router.PROFILES["BlueArchive"].lora_name)
        for non_control in ("@PC98..", "@PC98.,", "@PC98/path."):
            with self.subTest(non_control=non_control):
                clean, name, _, report = router.route_prompt(non_control, "RDBT")
                self.assertIn(non_control.rstrip(","), clean)
                self.assertEqual(name, router.PROFILES["RDBT"].lora_name)
                self.assertEqual(json.loads(report)["recognized_markers"], 0)

    def test_chinese_terminators_do_not_permit_path_suffixes(self):
        prompt = "@Mikko，nilou genshin、@RDBT。@PC98/../../foreign.safetensors"
        clean, name, _, report = router.route_prompt(prompt, "PC98")
        self.assertEqual(clean, "nilou genshin、@PC98/../../foreign.safetensors")
        self.assertEqual(name, router.PROFILES["RDBT"].lora_name)
        self.assertEqual(json.loads(report)["recognized_markers"], 2)
        clean, name, _, _ = router.route_prompt("@BlueArchive、adult woman。", "RDBT")
        self.assertEqual(clean, "@BlueArchStyle, adult woman。")
        self.assertEqual(name, router.PROFILES["BlueArchive"].lora_name)

    def test_empty_prompt_uses_only_selected_real_trigger(self):
        clean, name, _, _ = router.route_prompt("@BlueArchive")
        self.assertEqual(clean, "@BlueArchStyle")
        self.assertEqual(name, "BlueArchiveStyleB1.safetensors")
        self.assertEqual(router.route_prompt("", "RDBT")[0], "")

    def test_invalid_default_cannot_be_a_lora_path(self):
        with self.assertRaises(ValueError):
            router.route_prompt("adult woman", "../../outside.safetensors")

    def test_node_contract_is_typed_and_has_no_loading_dependency(self):
        node = router.AnimadexStyleRouter()
        self.assertEqual(node.RETURN_TYPES, ("STRING", "STRING", "FLOAT", "STRING"))
        inputs = node.INPUT_TYPES()["required"]
        self.assertTrue(inputs["prompt"][1]["forceInput"])
        self.assertEqual(inputs["default_style"][0], ["ModelDefault", "Painterly", "Mikko", "BlueArchive", "RDBT", "PC98"])
        self.assertEqual(node.route("@RDBT, adult woman"), router.route_prompt("@RDBT, adult woman"))

    def test_native_style_has_zero_lora_and_preserves_native_artist(self):
        clean, _, strength, report = router.route_prompt("@wlop, @mikkoani, scar-h (girls' frontline), @style:model_default")
        self.assertEqual(strength, 0)
        self.assertIn("@wlop", clean)
        self.assertIn("@mikkoani", clean)
        self.assertNotIn("@style:", clean)
        self.assertEqual(json.loads(report)["selected_style"], "ModelDefault")


if __name__ == "__main__":
    unittest.main()
