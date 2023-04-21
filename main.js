const {
  app,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  systemPreferences,
  ipcMain,
  dialog,
} = require("electron");
const { BrowserWindow } = require("electron-acrylic-window");
if (require("electron-squirrel-startup")) app.quit();

const appVersion = "0.1.0";
const releaseType = "beta";

const colors = require("colors");

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log("This is not the only instance. App will quit.".red);
  app.quit();
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else if (!mainWindow && !loadingScreen) {
      createWindow();
    }
  });
}

console.log(
  "Zefir's Flashy Cooler ver. ".yellow +
    appVersion.blue +
    "@" +
    releaseType.red +
    " starting...".yellow
);

const path = require("path");
require("update-electron-app")();
const { Worker, workerData } = require("worker_threads");
const { exec, execSync } = require("child_process");
const fs = require("fs");

let config;

try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, "app.config.json")));
} catch {
  config = {
    defaultThemePath: "",
    fps: 25,
    renderAtStartup: false,
    startMinimised: false,
    startAtLogin: false,
    showWarningAlert: true,
    rotation: 0,
  };
}

if (config.defaultThemePath == "") {
  config.defaultThemePath = path.join(
    __dirname,
    "themes",
    "static_image",
    "theme.js"
  );
}

if (!fs.existsSync(config.defaultThemePath)) {
  config.defaultThemePath = path.join(
    __dirname,
    "themes",
    "static_image",
    "theme.js"
  );
}

const { stringify } = require("querystring");

let iCueRunning = true;
let libreRunning = false;

nativeTheme.themeSource = "dark";

let fps = config.fps;
let availableDevice;
let mainWindow;
let rendering = config.renderAtStartup;
let activeThemeNeedsSensorsFlag = false;

ipcMain.handle("loading:closeApp", function () {
  exit(false);
});

ipcMain.handle("renderer:startRendering", startRendering);
ipcMain.handle("renderer:stopRendering", stopRendering);
ipcMain.handle("themes:getThemeList", getThemeList);
ipcMain.on("themes:themeSelected", selectTheme);
ipcMain.on("renderer:parameterTransfer", applyParameters);
ipcMain.handle("renderer:renderStatus", renderStatus);
ipcMain.handle("global:openFile", handleFileOpen);
ipcMain.handle("renderer:sensorInfo", handleSensorFullInfo);
ipcMain.handle("settings:requestConfig", requestConfig);
ipcMain.handle("settings:requestVersion", requestVersion);
ipcMain.handle("settings:requestHealth", requestHealth);
ipcMain.on("settings:configSendback", configSendback);
ipcMain.handle("settings:requestThemeFolder", requestThemeFolder);
ipcMain.handle("settings:openThemeFolder", openThemeFolder);
ipcMain.handle("device:requestDeviceInfo", requestDeviceInfo);
ipcMain.handle("renderer:updatePreview", sendFreshPreview);

ipcMain.handle("main:closeWindow", closeMainWindow);
ipcMain.handle("main:minimiseWindow", minimiseMainWindow);
ipcMain.handle("main:killApp", exit);

ipcMain.handle("loading:requestVersion", requestVersionLoading);

ipcMain.handle("device:rotateLeft", function () {
  rotate("left");
});
ipcMain.handle("device:rotateRight", function () {
  rotate("right");
});

function closeMainWindow() {
  mainWindow.close();
  mainWindow = null;
}

function minimiseMainWindow() {
  mainWindow.minimize();
}

function sendFreshPreview() {
  themeList.forEach((item) => {
    if (item.isActive) {
      mainWindow.webContents.send(
        "renderer:receiveFreshPreview",
        "data:image/jpeg;base64," + item.preview.toString("base64")
      );
    }
  });
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1130,
    height: 800,
    minWidth: 1130,
    minHeight: 800,
    webPreferences: {
      preload: path.join(__dirname, "libraries/preload.js"),
    },
    icon: path.join(__dirname, "assets", "images", "favicon.ico"),
    titleBarStyle: "hidden",
    vibrancy: {
      theme: "#080d1499",
      disableOnBlur: false,
      maximumRefreshRate: 120,
    },
  });
  mainWindow.loadFile(
    firstRun ? "assets/ui/onboarding.html" : "assets/ui/themes.html"
  );
  mainWindow.on("close", () => {
    mainWindow = null;
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

let worker;

let loadingScreen;

let hardwareTrees;
let themeList;

const firstRun = process.argv[1] == "--squirrel-firstrun" ? true : false;

app.whenReady().then(() => {
  loadingScreen = new BrowserWindow({
    width: 750,
    height: 400,
    webPreferences: {
      preload: path.join(__dirname, "libraries", "loadingPreload.js"),
    },
    icon: path.join(__dirname, "assets", "images", "favicon.ico"),
    titleBarStyle: "hidden",
    vibrancy: {
      theme: "#080d1499",
      disableOnBlur: false,
      maximumRefreshRate: 120,
    },
    alwaysOnTop: true,
    center: true,
  });
  loadingScreen.loadFile("assets/ui/loading.html");
  loadingScreen.once("ready-to-show", () => {
    sendConsole("Initialising app.");
    const startupWorker = new Worker(path.join(__dirname, "startup.js"), {
      workerData: { configuration: config },
    });
    startupWorker.on("error", (error) => {
      console.log(error);
    });
    startupWorker.on("unhandledRejection", (error) => {
      throw error;
    });
    startupWorker.on("message", (message) => {
      if (message.type == "console") {
        sendConsole(message.content);
      } else if (message.type == "error") {
        console.log("received error");
        console.log("message");
        loadingScreen.webContents.send("loading:error", [
          message.content,
          message.exText,
        ]);
      } else if (message.type == "done") {
        hardwareTrees = message.hardwareList;
        themeList = message.themeList;
        libreRunning = message.libreRunning;
        iCueRunning = message.iCueRunning;
        availableDevice = message.availableDevice;
        worker = new Worker(path.join(__dirname, "libraries", "renderer.js"), {
          workerData: {
            renderPath: config.defaultThemePath,
            fps: fps,
            availableDevice: availableDevice,
            rotation: config.rotation,
          },
        });
        worker.on("error", (err) => {
          console.log(err);
        });

        worker.on("message", (msg) => {
          // mainWindow.webContents.send("fps", msg);
          console.log(msg);
        });

        worker.on("unhandledRejection", (error) => {
          throw error;
        });
        console.log("Init finished successfully.".green);
        loadingScreen.close();
        loadingScreen = null;
        if (!config.startMinimised) {
          console.log("Creating window...");
          createWindow();
        }
        console.log("Creating tray...");
        createTray();
        if (rendering) {
          console.log("Autostarting rendering...".blue);
          startRendering();
        }
        console.log("App successfully opened.".green);
      }
    });
  });
});

let tray;

const contextMenuInactive = Menu.buildFromTemplate([
  {
    label: "Open Zefir's Flashy Cooler",
    click() {
      createWindow();
    },
  },
  {
    label: "Start Rendering",
    click() {
      startRendering();
    },
  },
  {
    label: "Quit Zefir's Flashy Cooler",
    click() {
      exit();
    },
  },
]);

const contextMenuActive = Menu.buildFromTemplate([
  {
    label: "Open Zefir's Flashy Cooler",
    click() {
      createWindow();
    },
  },
  {
    label: "Stop Rendering",
    click() {
      stopRendering();
    },
  },
  {
    label: "Quit Zefir's Flashy Cooler",
    click() {
      exit();
    },
  },
]);

const createTray = () => {
  tray = new Tray(path.join(__dirname, "assets", "images", "favicon.ico"));
  tray.setToolTip("Zefir's Flashy Cooler");
  tray.setContextMenu(contextMenuInactive);
};

app.on("window-all-closed", () => {
  // exit();
  // app.exit(0);
  // log();
});

function requestConfig() {
  mainWindow.webContents.send("settings:receiveConfig", config);
}

function requestVersion() {
  mainWindow.webContents.send(
    "settings:receiveVersion",
    appVersion + "@" + releaseType
  );
}

function sendConsole(content) {
  loadingScreen.webContents.send("loading:receiveConsole", content);
}

function requestVersionLoading() {
  loadingScreen.webContents.send(
    "loading:receiveVersion",
    appVersion + "@" + releaseType
  );
}

function requestHealth() {
  mainWindow.webContents.send("settings:receiveHealth", [
    iCueRunning,
    libreRunning,
  ]);
}

function requestThemeFolder() {
  mainWindow.webContents.send(
    "settings:receiveThemeFolder",
    path.join(__dirname, "themes")
  );
}

function requestDeviceInfo() {
  mainWindow.webContents.send("device:receiveDeviceInfo", availableDevice);
}

function openThemeFolder() {
  exec('start "' + path.join(__dirname, "themes") + '"');
}

function exit(safe = true) {
  if (safe) {
    themeList.forEach((theme) => {
      if (theme.isActive) {
        config.defaultThemePath = theme.path;
      }
    });
    const finalConfig = JSON.stringify(config);
    fs.writeFileSync(path.join(__dirname, "app.config.json"), finalConfig);
    worker.postMessage("exit");
  } else {
    if (worker != undefined) worker.postMessage("exit");
  }
  app.exit(0);
  process.exit(0);
}

function startRendering() {
  tray.setContextMenu(contextMenuActive);
  if (mainWindow != null) mainWindow.webContents.send("rendering", 1);
  worker.postMessage("start");
  rendering = true;
}

function stopRendering() {
  tray.setContextMenu(contextMenuInactive);
  if (mainWindow != null) mainWindow.webContents.send("rendering", 0);
  worker.postMessage("stop");
  rendering = false;
}

function getThemeList() {
  themeList.forEach((theme) => {
    mainWindow.webContents.send("theme", theme);
  });
  mainWindow.webContents.send("themes:addAdjust");
}

async function handleFileOpen() {
  const { canceled, filePaths } = await dialog.showOpenDialog();
  if (canceled) {
    return;
  } else {
    return filePaths[0];
  }
}

function handleSensorFullInfo() {
  if (libreRunning) {
    mainWindow.webContents.send("renderer:receiveSensorInfo", hardwareTrees);
  }
}

function selectTheme(_event, themeId) {
  const found = themeList.find((element) => element.id == themeId);
  themeList.forEach((item) => {
    if (item.id == themeId) {
      item.isActive = true;
      config.defaultThemePath = item.path;
      fs.writeFileSync(
        path.join(__dirname, "app.config.json"),
        JSON.stringify(config)
      );
      config = JSON.parse(
        fs.readFileSync(path.join(__dirname, "app.config.json"))
      );
    } else {
      item.isActive = false;
    }
  });
  worker.postMessage(found.path);
  if (rendering) {
    startRendering();
  }
}

function configSendback(_event, config) {
  const toWrite = JSON.stringify(config);
  fs.writeFileSync(path.join(__dirname, "app.config.json"), toWrite);
  app.setLoginItemSettings({
    openAtLogin: config.renderAtStartup,
    path: path.resolve(
      path.dirname(process.execPath),
      "..",
      "Zefir's Flashy Cooler.exe"
    ),
    args: ["--processStart", `${path.basename(process.execPath)}`],
    name: "Zefir's Flashy Cooler",
  });
  config = JSON.parse(fs.readFileSync(path.join(__dirname, "app.config.json")));
}

function renderStatus() {
  if (rendering) {
    mainWindow.webContents.send("rendering", 1);
  } else {
    mainWindow.webContents.send("rendering", 0);
  }
}

let applyLastTime = Date.now();

function rotate(direction) {
  const toIncrement = direction == "right" ? 90 : -90;
  let newAngle = config.rotation + toIncrement;
  if (newAngle >= 360 || newAngle <= -360) newAngle = 0;
  config.rotation = newAngle;
  const toWrite = JSON.stringify(config);
  fs.writeFileSync(path.join(__dirname, "app.config.json"), toWrite);
  config = JSON.parse(fs.readFileSync(path.join(__dirname, "app.config.json")));
  worker.postMessage("exit");
  worker.terminate();
  worker = null;
  worker = new Worker(path.join(__dirname, "libraries", "renderer.js"), {
    workerData: {
      renderPath: config.defaultThemePath,
      fps: fps,
      availableDevice: availableDevice,
      rotation: config.rotation,
    },
  }); // worker needs to be destroyed for on the fly editing to work
  worker.on("error", (err) => {
    console.log(err);
  });

  worker.on("message", (msg) => {
    // mainWindow.webContents.send("fps", msg);
    console.log(msg);
  });

  worker.on("unhandledRejection", (error) => {
    throw error;
  });
  if (rendering) {
    startRendering();
  }
}

function applyParameters(_event, parameters) {
  if (Date.now() - 2 * 1000 > applyLastTime) {
    worker.postMessage("exit");
    worker.terminate();
    worker = null;
    themeList.forEach((item) => {
      if (item.isActive) {
        const configTheme = JSON.parse(fs.readFileSync(item.configPath));
        Object.keys(configTheme).forEach((key) => {
          parameters.forEach((parameter) => {
            if (parameter.varName == key) {
              configTheme[key] = parameter.value;
            }
          });
          Object.keys(item.controllableParameters).forEach((localParameter) => {
            parameters.forEach((parameter) => {
              if (
                item.controllableParameters[localParameter]["varName"] ==
                parameter.varName
              ) {
                item.controllableParameters[localParameter]["value"] =
                  parameter.value;
              }
            });
          });
        });
        const finalConfig = JSON.stringify(configTheme);
        fs.writeFileSync(item.configPath, finalConfig);
        const theme = require(item.path);
        item.preview =
          "data:image/jpeg;base64," + theme.renderPreview().toString("base64");
        worker = new Worker(path.join(__dirname, "libraries", "renderer.js"), {
          workerData: {
            renderPath: item.path,
            fps: fps,
            availableDevice: availableDevice,
            rotation: config.rotation,
          },
        }); // worker needs to be destroyed for on the fly editing to work
        worker.on("error", (err) => {
          console.log(err);
        });

        worker.on("message", (msg) => {
          // mainWindow.webContents.send("fps", msg);
          console.log(msg);
        });

        worker.on("unhandledRejection", (error) => {
          throw error;
        });
        if (rendering) {
          startRendering();
        }
      }
    });
    applyLastTime = Date.now();
  }
}

function sleep(milliseconds) {
  const date = Date.now();
  let currentDate = null;
  do {
    currentDate = Date.now();
  } while (currentDate - date < milliseconds);
}

//do something when app is closing
process.on("exit", function () {
  exit(false);
});

//catches ctrl+c event
process.on("SIGINT", function () {
  exit(false);
});

// catches "kill pid" (for example: nodemon restart)
process.on("SIGUSR1", function () {
  exit(false);
});
process.on("SIGUSR2", function () {
  exit(false);
});

//catches uncaught exceptions
process.on("uncaughtException", function () {
  exit(false);
});

// Start reading from stdin so we don't exit.
process.stdin.resume();
