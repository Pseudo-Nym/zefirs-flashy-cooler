import sys
sys.path.append("libraries")
sys.path.append("themes")
# todo: sort this out
from libraries.lcd import LCD
from libraries.render import Renderer
from themes.time.theme import Time
from themes.static_image.theme import Static_Image

if __name__ == "__main__":
    lcd = LCD(25)
    theme = Time()
    # theme = Static_Image("image2.jpeg")
    renderer = Renderer(lcd, theme)
    renderer.start_rendering()
    if input("press enter to stop") is not None:
        renderer.stop_rendering()
        sys.exit()
    #### todo make it smoother and less cpu heavy