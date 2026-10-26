"""Manim cards for the Coverage demo video (Text only, no LaTeX).

Render (from demo-video/):
  manim -qh --fps 30 -r 1920,1080 scenes.py TitleCard
  manim -qh --fps 30 -r 1920,1080 scenes.py OutroCard
  manim -qh --fps 30 -r 1920,1080 --transparent scenes.py Caption   (one clip per entry in captions.json)
build.mjs runs all of these.
"""
import json
import os
from pathlib import Path

from manim import (
    DOWN, LEFT, UP, Create, FadeIn, FadeOut, Line, RoundedRectangle, Scene, Square, Text,
    VGroup, Write, config, rate_functions,
)

NAVY = "#0e1a2b"
CREAM = "#f4f3ef"
GREEN = "#1f7a5c"
MINT = "#2a9a74"
MUTED = "#9aa6b5"
FONT = "Segoe UI"

HERE = Path(__file__).parent


def logo(size=1.1):
    """A simple mark in the logo's colors: a navy tile with a green check bar."""
    tile = RoundedRectangle(corner_radius=0.18 * size, width=size, height=size, fill_color=GREEN, fill_opacity=1, stroke_width=0)
    bar1 = Line(LEFT * 0.28 * size + DOWN * 0.02 * size, LEFT * 0.06 * size + DOWN * 0.24 * size, stroke_width=10 * size, color=CREAM)
    bar2 = Line(LEFT * 0.06 * size + DOWN * 0.24 * size, LEFT * -0.3 * size + UP * 0.22 * size, stroke_width=10 * size, color=CREAM)
    return VGroup(tile, bar1, bar2)


class TitleCard(Scene):
    """~10 s: logo, name, pitch, URL."""

    def construct(self):
        self.camera.background_color = NAVY
        mark = logo(1.3)
        name = Text("Coverage", font=FONT, weight="BOLD", font_size=110, color=CREAM)
        head = VGroup(mark, name).arrange(buff=0.45)
        pitch = Text(
            "Run your investment banking networking from one desk",
            font=FONT, font_size=34, color=CREAM,
        )
        sub = Text("Track bankers · sync Gmail · never miss a follow-up or a coffee chat", font=FONT, font_size=28, color=MUTED)
        url = Text("banker-dashboard-three.vercel.app", font=FONT, font_size=26, color=MINT)
        group = VGroup(head, pitch, sub, url).arrange(DOWN, buff=0.5)
        url.shift(DOWN * 0.4)

        self.play(FadeIn(mark, scale=0.6), run_time=0.8)
        self.play(Write(name), run_time=1.2)
        self.play(FadeIn(pitch, shift=UP * 0.2), run_time=1.0)
        self.play(FadeIn(sub, shift=UP * 0.2), run_time=0.9)
        self.play(FadeIn(url), run_time=0.6)
        self.wait(4.5)
        self.play(FadeOut(group), run_time=0.8)


class OutroCard(Scene):
    """~8 s: recap + call to action."""

    def construct(self):
        self.camera.background_color = NAVY
        mark = logo(0.9)
        name = Text("Coverage", font=FONT, weight="BOLD", font_size=80, color=CREAM)
        head = VGroup(mark, name).arrange(buff=0.35)
        bullets = VGroup(*[
            Text(t, font=FONT, font_size=34, color=CREAM)
            for t in ("✓  Every banker and status in one tracker", "✓  Gmail keeps it current", "✓  Calendar chats show up on their own")
        ]).arrange(DOWN, aligned_edge=LEFT, buff=0.3)
        cta = Text("Try it free · banker-dashboard-three.vercel.app", font=FONT, font_size=34, color=MINT)
        group = VGroup(head, bullets, cta).arrange(DOWN, buff=0.7)

        self.play(FadeIn(head, shift=DOWN * 0.2), run_time=0.8)
        for b in bullets:
            self.play(FadeIn(b, shift=LEFT * 0.3), run_time=0.5)
        self.play(FadeIn(cta, scale=0.9), run_time=0.8)
        self.wait(4.0)
        self.play(FadeOut(group), run_time=0.8)


class Caption(Scene):
    """A lower-third caption with a transparent background.

    Reads CAPTION_INDEX from the environment and the text from captions.json ({"title", "body", "seconds"}).
    """

    def construct(self):
        items = json.loads((HERE / "captions.json").read_text(encoding="utf-8"))
        item = items[int(os.environ.get("CAPTION_INDEX", "0"))]
        seconds = float(item.get("seconds", 4))

        title = Text(item["title"], font=FONT, weight="BOLD", font_size=34, color=CREAM)
        body = Text(item.get("body", ""), font=FONT, font_size=26, color=CREAM) if item.get("body") else None
        texts = VGroup(title, body).arrange(DOWN, aligned_edge=LEFT, buff=0.14) if body else VGroup(title)
        pad_x, pad_y = 0.45, 0.28
        box = RoundedRectangle(
            corner_radius=0.16, width=texts.width + 2 * pad_x + 0.18, height=texts.height + 2 * pad_y,
            fill_color=NAVY, fill_opacity=0.92, stroke_width=0,
        )
        accent = Square(1, fill_color=GREEN, fill_opacity=1, stroke_width=0).stretch_to_fit_width(0.1).stretch_to_fit_height(box.height)
        accent.align_to(box, LEFT).align_to(box, UP)
        texts.align_to(box, LEFT).shift(LEFT * 0 + LEFT * -(pad_x + 0.18))
        texts.move_to([box.get_left()[0] + pad_x + 0.18 + texts.width / 2, box.get_center()[1], 0])
        card = VGroup(box, accent, texts)
        # Bottom-left with a margin, clear of the browser's own content edges.
        card.to_corner(DOWN + LEFT, buff=0.55)

        self.play(FadeIn(card, shift=UP * 0.25), run_time=0.45, rate_func=rate_functions.ease_out_cubic)
        self.wait(max(0.5, seconds - 0.9))
        self.play(FadeOut(card, shift=DOWN * 0.15), run_time=0.45)
