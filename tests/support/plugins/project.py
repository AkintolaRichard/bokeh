#-----------------------------------------------------------------------------
# Copyright (c) 2012 - 2024, Anaconda, Inc., and Bokeh Contributors.
# All rights reserved.
#
# The full license is in the file LICENSE.txt, distributed with this software.
#-----------------------------------------------------------------------------
''' Define a Pytest plugin for a Bokeh-specific testing tools.

'''

#-----------------------------------------------------------------------------
# Boilerplate
#-----------------------------------------------------------------------------
from __future__ import annotations

import logging # isort:skip
log = logging.getLogger(__name__)

#-----------------------------------------------------------------------------
# Imports
#-----------------------------------------------------------------------------

# Standard library imports
import socket
import time
from contextlib import closing
from threading import Thread
from typing import (
    TYPE_CHECKING,
    Any,
    Callable,
    Protocol,
)

# External imports
import pytest
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.wait import WebDriverWait
from tornado.ioloop import IOLoop
from tornado.web import RequestHandler

if TYPE_CHECKING:
    from selenium.webdriver.common.keys import _KeySeq
    from selenium.webdriver.remote.webdriver import WebDriver
    from selenium.webdriver.remote.webelement import WebElement

# Bokeh imports
import bokeh.server.views.ws as ws
from bokeh.application.handlers.function import ModifyDoc
from bokeh.io import save
from bokeh.models import LayoutDOM, Plot
from bokeh.server.server import Server
from tests.support.util.selenium import (
    INIT,
    RESULTS,
    find_matching_element,
    get_events_el,
)

if TYPE_CHECKING:
    from bokeh.model import Model
    from tests.support.plugins.file_server import SimpleWebServer

#-----------------------------------------------------------------------------
# Globals and constants
#-----------------------------------------------------------------------------

pytest_plugins = (
    "tests.support.plugins.project",
    "tests.support.plugins.file_server",
    "tests.support.plugins.selenium",
)

__all__ = (
    'bokeh_app_info',
    'bokeh_model_page',
    'bokeh_server_page',
    'find_free_port',
    'output_file_url',
    'single_plot_page',
    'test_file_path_and_url',
)

#-----------------------------------------------------------------------------
# General API
#-----------------------------------------------------------------------------

@pytest.fixture
def output_file_url(request: pytest.FixtureRequest, file_server: SimpleWebServer) -> str:
    from bokeh.io import output_file
    file_name = request.function.__name__ + '.html'
    file_path = request.node.path.with_name(file_name)

    output_file(file_path, mode='inline')

    def tear_down() -> None:
        if file_path.is_file():
            file_path.unlink()
    request.addfinalizer(tear_down)

    return file_server.where_is(file_path)

@pytest.fixture
def test_file_path_and_url(request: pytest.FixtureRequest, file_server: SimpleWebServer) -> tuple[str, str]:
    file_name = request.function.__name__ + '.html'
    file_path = request.node.path.with_name(file_name)

    def tear_down() -> None:
        if file_path.is_file():
            file_path.unlink()
    request.addfinalizer(tear_down)

    return file_path, file_server.where_is(file_path)

class _ExitHandler(RequestHandler):
    def initialize(self, io_loop: IOLoop) -> None:
        self.io_loop = io_loop
    async def get(self, *args: Any, **kwargs: Any) -> None:
        self.io_loop.stop()


def find_free_port() -> int:
    with closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

class BokehAppInfo(Protocol):
    def __call__(self, modify_doc: ModifyDoc) -> tuple[str, ws.MessageTestPort]: ...

class HasNoConsoleErrors(Protocol):
    def __call__(self, webdriver: WebDriver) -> bool: ...

@pytest.fixture
def bokeh_app_info(request: pytest.FixtureRequest, driver: WebDriver) -> BokehAppInfo:
    ''' Start a Bokeh server app and return information needed to test it.

    Returns a tuple (url, message_test_port), where the latter is an instance of
    ``MessageTestPort`` dataclass, and will contain all messages that the Bokeh
    Server sends/receives while running during the test.

    '''

    def func(modify_doc: ModifyDoc) -> tuple[str, ws.MessageTestPort]:
        ws._message_test_port = ws.MessageTestPort(sent=[], received=[])
        port = find_free_port()
        def worker() -> None:
            io_loop = IOLoop()
            server = Server({'/': modify_doc},
                            port=port,
                            io_loop=io_loop,
                            extra_patterns=[('/exit', _ExitHandler, dict(io_loop=io_loop))])
            server.start()
            server.io_loop.start()

        t = Thread(target=worker)
        t.start()

        def cleanup() -> None:
            driver.get(f"http://localhost:{port}/exit")

            # XXX (bev) this line is a workaround for https://github.com/bokeh/bokeh/issues/7970
            # and should be removed when that issue is resolved
            driver.get_log('browser')

            ws._message_test_port = None
            t.join()

        request.addfinalizer(cleanup)

        return f"http://localhost:{port}/", ws._message_test_port

    return func

class _ElementMixin:
    _driver: WebDriver

    def click_element_at_position(self, element: WebElement, x: int, y: int) -> None:
        actions = ActionChains(self._driver)
        actions.move_to_element_with_offset(element, x, y)
        actions.click()
        actions.perform()

    def double_click_element_at_position(self, element: WebElement, x: int, y: int) -> None:
        actions = ActionChains(self._driver)
        actions.move_to_element_with_offset(element, x, y)
        actions.click()
        actions.click()
        actions.perform()

    def drag_element_at_position(self, element: WebElement, x: int, y: int, dx: int, dy: int, mod: _KeySeq | None = None) -> None:
        actions = ActionChains(self._driver)
        if mod:
            actions.key_down(mod)
        actions.move_to_element_with_offset(element, x, y)
        actions.click_and_hold()
        actions.move_by_offset(dx, dy)
        actions.release()
        if mod:
            actions.key_up(mod)
        actions.perform()

    def send_keys(self, *keys: _KeySeq) -> None:
        actions = ActionChains(self._driver)
        actions.send_keys(*keys)
        actions.perform()

class _CanvasMixin(_ElementMixin):
    canvas: WebElement

    def click_canvas_at_position(self, plot: Plot, x: int, y: int) -> None:
        events_el = get_events_el(self._driver, plot)
        self.click_element_at_position(events_el, x, y)

    def double_click_canvas_at_position(self, plot: Plot, x: int, y: int) -> None:
        events_el = get_events_el(self._driver, plot)
        self.double_click_element_at_position(events_el, x, y)

    def drag_canvas_at_position(self, plot: Plot, x: int, y: int, dx: int, dy: int, mod: _KeySeq | None = None) -> None:
        events_el = get_events_el(self._driver, plot)
        self.drag_element_at_position(events_el, x, y, dx, dy, mod)

    def eval_custom_action(self) -> None:
        return self._driver.execute_script('Bokeh.documents[0].get_model_by_name("custom-action").execute()')

    def get_toolbar_buttons(self, plot: Plot) -> list[WebElement]:
        script = """
            const toolbar_id = arguments[0]
            const toolbar_view = Bokeh.index.get_one_by_id(toolbar_id)
            return toolbar_view.model.tools.map((tool) => toolbar_view.owner.query_one((btn) => btn.model.tool == tool).el)
        """
        buttons = self._driver.execute_script(script, plot.toolbar.id)
        return buttons

class _BokehPageMixin(_ElementMixin):

    test_div: WebElement
    _driver: WebDriver
    _has_no_console_errors: HasNoConsoleErrors

    @property
    def results(self) -> dict[str, Any]:
        WebDriverWait(self._driver, 10).until(EC.staleness_of(self.test_div))
        self.test_div = find_matching_element(self._driver, ".bokeh-test-div")
        return self._driver.execute_script(RESULTS)

    @property
    def driver(self) -> WebDriver:
        return self._driver

    def init_results(self) -> None:
        self._driver.execute_script(INIT)
        self.test_div = find_matching_element(self._driver, ".bokeh-test-div")

    def has_no_console_errors(self) -> bool:
        return self._has_no_console_errors(self._driver)

class _BokehModelPage(_BokehPageMixin):

    def __init__(self, model: LayoutDOM, driver: WebDriver, output_file_url: str, has_no_console_errors: HasNoConsoleErrors) -> None:
        self._driver = driver
        self._model = model
        self._has_no_console_errors = has_no_console_errors

        save(self._model)
        self._driver.get(output_file_url)
        self.init_results()

        await_ready(driver, model)

BokehModelPage = Callable[[LayoutDOM], _BokehModelPage]

@pytest.fixture()
def bokeh_model_page(driver: WebDriver, output_file_url: str, has_no_console_errors: HasNoConsoleErrors) -> BokehModelPage:
    def func(model: LayoutDOM) -> _BokehModelPage:
        return _BokehModelPage(model, driver, output_file_url, has_no_console_errors)
    return func

class _SinglePlotPage(_BokehModelPage, _CanvasMixin):

    # model may be a layout, but should only contain a single plot
    def __init__(self, model: LayoutDOM, driver: WebDriver, output_file_url: str, has_no_console_errors: HasNoConsoleErrors) -> None:
        super().__init__(model, driver, output_file_url, has_no_console_errors)

SinglePlotPage = Callable[[LayoutDOM], _SinglePlotPage]

@pytest.fixture()
def single_plot_page(driver: WebDriver, output_file_url: str,
        has_no_console_errors: HasNoConsoleErrors) -> SinglePlotPage:
    def func(model: LayoutDOM) -> _SinglePlotPage:
        return _SinglePlotPage(model, driver, output_file_url, has_no_console_errors)
    return func

class _BokehServerPage(_BokehPageMixin, _CanvasMixin):

    def __init__(self, modify_doc: ModifyDoc, driver: WebDriver, bokeh_app_info: BokehAppInfo, has_no_console_errors: HasNoConsoleErrors) -> None:
        self._driver = driver
        self._has_no_console_errors = has_no_console_errors

        self._app_url, self.message_test_port = bokeh_app_info(modify_doc)
        time.sleep(0.1)
        self._driver.get(self._app_url)

        self.init_results()

        def ready(driver: WebDriver) -> bool:
            try:
                await_all_ready(driver)
                return True
            except RuntimeError:
                return False
        WebDriverWait(self._driver, 10).until(ready)

BokehServerPage = Callable[[ModifyDoc], _BokehServerPage]

@pytest.fixture()
def bokeh_server_page(driver: WebDriver, bokeh_app_info: BokehAppInfo,
        has_no_console_errors: HasNoConsoleErrors) -> BokehServerPage:
    def func(modify_doc: ModifyDoc) -> _BokehServerPage:
        return _BokehServerPage(modify_doc, driver, bokeh_app_info, has_no_console_errors)
    return func

def await_ready(driver: WebDriver, root: Model) -> None:
    script = """
    const [root_id, done] = [...arguments];
    (async function() {
        const view = Bokeh.index.get_by_id(root_id)
        if (view == null)
            done(false)
        else {
            await view.ready
            done(true)
        }
    })()
    """
    if not driver.execute_async_script(script, root.id):
        raise RuntimeError(f"could not find a root view for {root}")

def await_all_ready(driver: WebDriver) -> None:
    script = """
    const [done] = [...arguments];
    (async function() {
        const views = Bokeh.index.roots
        if (views.length == 0)
            done(false)
        else {
            await Promise.all(views.map((view) => view.ready))
            done(true)
        }
    })()
    """
    if not driver.execute_async_script(script):
        raise RuntimeError("could not find any root views")

#-----------------------------------------------------------------------------
# Dev API
#-----------------------------------------------------------------------------

#-----------------------------------------------------------------------------
# Private API
#-----------------------------------------------------------------------------

#-----------------------------------------------------------------------------
# Code
#-----------------------------------------------------------------------------
