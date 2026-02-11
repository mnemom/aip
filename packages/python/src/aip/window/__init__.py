"""Window state management."""

from aip.window.manager import WindowManager
from aip.window.state import WindowState, WindowStats, create_window_state

__all__ = [
    "WindowState",
    "WindowStats",
    "create_window_state",
    "WindowManager",
]
