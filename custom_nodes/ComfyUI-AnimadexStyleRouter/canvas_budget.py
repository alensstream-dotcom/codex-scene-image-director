"""Choose a fixed generation budget from a requested canvas orientation."""


def budget_canvas(requested_width=704, requested_height=1152):
    for name, value in (("requested_width", requested_width), ("requested_height", requested_height)):
        if isinstance(value, bool) or not isinstance(value, int):
            raise TypeError(f"{name} must be an integer")
        if not 64 <= value <= 8192:
            raise ValueError(f"{name} must be between 64 and 8192")

    # Integer comparisons make the exact 1.15 boundary unambiguous.
    if requested_height * 100 >= requested_width * 115:
        width, height = 704, 1152
    elif requested_width * 100 >= requested_height * 115:
        width, height = 1152, 704
    else:
        width, height = 896, 896

    return width, height, width * 5 // 4, height * 5 // 4


class AnimadexCanvasBudget:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "requested_width": ("INT", {"default": 704, "min": 64, "max": 8192}),
            "requested_height": ("INT", {"default": 1152, "min": 64, "max": 8192}),
        }}

    RETURN_TYPES = ("INT", "INT", "INT", "INT")
    RETURN_NAMES = ("width", "height", "output_width", "output_height")
    FUNCTION = "budget"
    CATEGORY = "Animadex"
    DESCRIPTION = (
        "Choose a fixed canvas budget from requested orientation: 704x1152 portrait, "
        "1152x704 landscape, or 896x896 near-square. Output dimensions are 1.25x. "
        "This node only returns integer dimensions and performs no image operations."
    )

    def budget(self, requested_width=704, requested_height=1152):
        return budget_canvas(requested_width, requested_height)
