import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "canvas_budget.py"
SPEC = importlib.util.spec_from_file_location("animadex_canvas_budget_test_module", MODULE_PATH)
canvas = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(canvas)


class CanvasBudgetTests(unittest.TestCase):
    def test_portrait_including_exact_ratio_boundary(self):
        self.assertEqual(canvas.budget_canvas(1024, 1536), (704, 1152, 880, 1440))
        self.assertEqual(canvas.budget_canvas(100, 115), (704, 1152, 880, 1440))
        self.assertEqual(canvas.budget_canvas(704, 1152), (704, 1152, 880, 1440))

    def test_landscape_including_exact_ratio_boundary(self):
        self.assertEqual(canvas.budget_canvas(1536, 1024), (1152, 704, 1440, 880))
        self.assertEqual(canvas.budget_canvas(115, 100), (1152, 704, 1440, 880))

    def test_near_square_just_inside_both_ratio_boundaries(self):
        self.assertEqual(canvas.budget_canvas(1024, 1024), (896, 896, 1120, 1120))
        self.assertEqual(canvas.budget_canvas(100, 114), (896, 896, 1120, 1120))
        self.assertEqual(canvas.budget_canvas(114, 100), (896, 896, 1120, 1120))

    def test_int_metadata_and_input_range_are_explicit(self):
        node = canvas.AnimadexCanvasBudget()
        self.assertEqual(node.RETURN_TYPES, ("INT", "INT", "INT", "INT"))
        self.assertEqual(node.RETURN_NAMES, ("width", "height", "output_width", "output_height"))
        inputs = node.INPUT_TYPES()["required"]
        self.assertEqual(inputs["requested_width"], ("INT", {"default": 704, "min": 64, "max": 8192}))
        self.assertEqual(inputs["requested_height"], ("INT", {"default": 1152, "min": 64, "max": 8192}))
        self.assertEqual(node.budget(), (704, 1152, 880, 1440))

    def test_invalid_values_cannot_silently_change_the_budget(self):
        for invalid in (0, 63, 8193):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                canvas.budget_canvas(invalid, 704)
        for invalid in (True, 704.0, "704"):
            with self.subTest(invalid=invalid), self.assertRaises(TypeError):
                canvas.budget_canvas(704, invalid)


if __name__ == "__main__":
    unittest.main()
