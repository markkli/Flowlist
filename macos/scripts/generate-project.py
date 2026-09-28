#!/usr/bin/env python3
"""Generate the checked-in Xcode project without third-party build dependencies."""
from pathlib import Path
import hashlib
import json
import subprocess

root = Path(__file__).resolve().parents[1]
objects = {}
project = root / "Flowlist.xcodeproj"
previous_objects = {}
if (project / "project.pbxproj").exists():
    # Xcode may have added the developer's team/certificate selection. Preserve
    # those settings instead of silently resetting them whenever sources change.
    result = subprocess.run(
        ["/usr/bin/plutil", "-convert", "json", "-o", "-", str(project / "project.pbxproj")],
        check=True, capture_output=True, text=True,
    )
    previous_objects = json.loads(result.stdout).get("objects", {})

signing_keys = {
    "DEVELOPMENT_TEAM", "CODE_SIGN_IDENTITY", "CODE_SIGN_STYLE",
    "CODE_SIGNING_ALLOWED", "CODE_SIGNING_REQUIRED", "PROVISIONING_PROFILE",
    "PROVISIONING_PROFILE_SPECIFIER", "OTHER_CODE_SIGN_FLAGS",
}

def identifier(key):
    return hashlib.sha1(key.encode()).hexdigest()[:24].upper()

def add(key, isa, **values):
    uid = identifier(key)
    objects[uid] = dict(isa=isa, **values)
    return uid

def serialize(value, indent=0):
    if isinstance(value, dict):
        return "{\n" + "\n".join("\t" * (indent + 1) + json.dumps(str(k)) + " = " + serialize(v, indent + 1) + ";" for k, v in value.items()) + "\n" + "\t" * indent + "}"
    if isinstance(value, list):
        return "(" + ", ".join(serialize(v, indent) for v in value) + ")"
    return json.dumps(str(value))

core = sorted(str(p.relative_to(root)) for p in (root / "Sources/FlowlistCore").glob("*.swift"))
app = sorted(str(p.relative_to(root)) for p in (root / "Sources/FlowlistMac").glob("*.swift"))
resources = sorted(str(p.relative_to(root)) for p in (root / "Sources/FlowlistMac/Resources").glob("*") if p.name != "WebUI")
web_resource = "Sources/FlowlistMac/Resources/WebUI"
paths = core + app + resources + ["Widget/FlowlistWidget.swift", web_resource, "Configuration/Signing.xcconfig"]
files = {}
for path in paths:
    kind = ("folder" if path == web_resource else "text.xcconfig" if path.endswith(".xcconfig")
            else "sourcecode.swift" if path.endswith(".swift") else "image.icns" if path.endswith(".icns") else "image.jpeg")
    files[path] = add("file:" + path, "PBXFileReference", path=path, sourceTree="<group>", lastKnownFileType=kind)

app_product = add("product:app", "PBXFileReference", path="Flowlist.app", sourceTree="BUILT_PRODUCTS_DIR", explicitFileType="wrapper.application")
widget_product = add("product:widget", "PBXFileReference", path="FlowlistWidget.appex", sourceTree="BUILT_PRODUCTS_DIR", explicitFileType="wrapper.app-extension")
products = add("products", "PBXGroup", name="Products", sourceTree="<group>", children=[app_product, widget_product])
group = add("main-group", "PBXGroup", sourceTree="<group>", children=list(files.values()) + [products])

def build_phase(name, isa, paths):
    builds = [add("build:" + name + path, "PBXBuildFile", fileRef=files[path]) for path in paths]
    return add("phase:" + name, isa, buildActionMask=2147483647, files=builds, runOnlyForDeploymentPostprocessing=0)

def configurations(name, settings):
    ids = []
    for mode in ["Debug", "Release"]:
        values = dict(settings)
        values["SWIFT_OPTIMIZATION_LEVEL"] = "-Onone" if mode == "Debug" else "-O"
        values["DEBUG_INFORMATION_FORMAT"] = "dwarf" if mode == "Debug" else "dwarf-with-dsym"
        if mode == "Debug":
            values["SWIFT_ACTIVE_COMPILATION_CONDITIONS"] = "DEBUG"
        old_values = previous_objects.get(identifier("config:" + name + mode), {}).get("buildSettings", {})
        for key, value in old_values.items():
            # The original generated project used ad-hoc signing by default.
            # Let automatic/xcconfig signing take over once a team is selected.
            if key == "CODE_SIGN_IDENTITY" and value == "-" and not old_values.get("DEVELOPMENT_TEAM"):
                continue
            if key.split("[", 1)[0] in signing_keys:
                values[key] = value
        extra = {"baseConfigurationReference": files["Configuration/Signing.xcconfig"]} if name != "project" else {}
        ids.append(add("config:" + name + mode, "XCBuildConfiguration", name=mode, buildSettings=values, **extra))
    return add("configs:" + name, "XCConfigurationList", buildConfigurations=ids, defaultConfigurationIsVisible=0, defaultConfigurationName="Release")

base = dict(ALWAYS_SEARCH_USER_PATHS="NO", SWIFT_VERSION="5.0", MACOSX_DEPLOYMENT_TARGET="14.0", SDKROOT="macosx", CODE_SIGN_STYLE="Automatic", ENABLE_HARDENED_RUNTIME="YES", PRODUCT_NAME="$(TARGET_NAME)", COMBINE_HIDPI_IMAGES="YES")
widget_settings = dict(base, PRODUCT_BUNDLE_IDENTIFIER="dev.flowlist.mac.widget", INFOPLIST_FILE="Configuration/Widget-Info.plist", CODE_SIGN_ENTITLEMENTS="Configuration/Widget.entitlements", APPLICATION_EXTENSION_API_ONLY="YES", SKIP_INSTALL="YES")
widget_sources = core + ["Sources/FlowlistMac/Design.swift", "Widget/FlowlistWidget.swift"]
widget_target = add("target:widget", "PBXNativeTarget", name="FlowlistWidget", productName="FlowlistWidget", productReference=widget_product, productType="com.apple.product-type.app-extension", buildConfigurationList=configurations("widget", widget_settings), buildPhases=[build_phase("widget-sources", "PBXSourcesBuildPhase", widget_sources), build_phase("widget-resources", "PBXResourcesBuildPhase", resources)], buildRules=[], dependencies=[])

proxy = add("proxy:widget", "PBXContainerItemProxy", containerPortal=identifier("project"), proxyType=1, remoteGlobalIDString=widget_target, remoteInfo="FlowlistWidget")
dependency = add("depends:widget", "PBXTargetDependency", target=widget_target, targetProxy=proxy)
embed_file = add("embed:widget", "PBXBuildFile", fileRef=widget_product, settings={"ATTRIBUTES": ["RemoveHeadersOnCopy"]})
embed = add("embed-phase", "PBXCopyFilesBuildPhase", name="Embed App Extensions", buildActionMask=2147483647, dstPath="", dstSubfolderSpec=13, files=[embed_file], runOnlyForDeploymentPostprocessing=0)
web_build = add("phase:build-web", "PBXShellScriptBuildPhase", name="Build bundled dashboard", buildActionMask=2147483647,
                shellPath="/bin/bash", shellScript='set -euo pipefail\n/bin/bash "$SRCROOT/scripts/build-web.sh"\n',
                inputPaths=[], outputPaths=["$(SRCROOT)/" + web_resource], files=[],
                alwaysOutOfDate=1, runOnlyForDeploymentPostprocessing=0)
app_settings = dict(base, PRODUCT_BUNDLE_IDENTIFIER="dev.flowlist.mac", INFOPLIST_FILE="Configuration/App-Info.plist", CODE_SIGN_ENTITLEMENTS="Configuration/App.entitlements", ENABLE_USER_SCRIPT_SANDBOXING="NO")
app_target = add("target:app", "PBXNativeTarget", name="Flowlist", productName="Flowlist", productReference=app_product, productType="com.apple.product-type.application", buildConfigurationList=configurations("app", app_settings), buildPhases=[web_build, build_phase("app-sources", "PBXSourcesBuildPhase", core + app), build_phase("app-resources", "PBXResourcesBuildPhase", resources + [web_resource]), embed], buildRules=[], dependencies=[dependency])

previous_target_attributes = previous_objects.get(identifier("project"), {}).get("attributes", {}).get("TargetAttributes", {})
target_attributes = {target: {"ProvisioningStyle": "Automatic", **previous_target_attributes.get(target, {})} for target in [app_target, widget_target]}
project_id = add("project", "PBXProject", attributes={"LastSwiftUpdateCheck": "1600", "LastUpgradeCheck": "1600", "TargetAttributes": target_attributes}, buildConfigurationList=configurations("project", {}), compatibilityVersion="Xcode 14.0", developmentRegion="en", knownRegions=["en", "Base"], mainGroup=group, productRefGroup=products, projectDirPath="", projectRoot="", targets=[app_target, widget_target])
project.mkdir(exist_ok=True)
(project / "project.pbxproj").write_text("// !$*UTF8*$!\n" + serialize(dict(archiveVersion=1, classes={}, objectVersion=56, objects=objects, rootObject=project_id)) + "\n")
schemes = project / "xcshareddata/xcschemes"
schemes.mkdir(parents=True, exist_ok=True)
ref = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{app_target}" BuildableName="Flowlist.app" BlueprintName="Flowlist" ReferencedContainer="container:Flowlist.xcodeproj"/>'
(schemes / "Flowlist.xcscheme").write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{ref}</BuildActionEntry></BuildActionEntries></BuildAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{ref}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
''')
print("Generated macos/Flowlist.xcodeproj")
