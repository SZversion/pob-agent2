#include <node_api.h>
#include <windows.h>
#include <tlhelp32.h>
#include <wbemidl.h>
#include <shellapi.h>
#include <atomic>
#include <cwchar>
#include <string>
#include <thread>
#include <vector>

struct Event {
  const char* type;
  DWORD pid;
  std::string stage;
};

struct Subscription {
  std::atomic<bool> running{true};
  napi_threadsafe_function callback;
  std::thread started;
  std::thread stopped;
};

static HANDLE watcherMutex = nullptr;
static Subscription* subscription = nullptr;

static DWORD CurrentSession() {
  DWORD session = 0;
  ProcessIdToSessionId(GetCurrentProcessId(), &session);
  return session;
}

static napi_value ThrowWindowsError(napi_env env, const char* message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}

static napi_value ThrowLastError(napi_env env, const char* message) {
  std::string detail = std::string(message) + " (Windows error " + std::to_string(GetLastError()) + ")";
  return ThrowWindowsError(env, detail.c_str());
}

static napi_value AcquireLock(napi_env env, napi_callback_info) {
  bool acquired = watcherMutex != nullptr;
  if (!watcherMutex) {
    HANDLE handle = CreateMutexW(nullptr, FALSE, L"Local\\PoBAgentWatcher");
    if (!handle) return ThrowWindowsError(env, "Could not create PoB watcher mutex");
    acquired = GetLastError() != ERROR_ALREADY_EXISTS;
    if (acquired) watcherMutex = handle;
    else CloseHandle(handle);
  }
  napi_value result;
  napi_get_boolean(env, acquired, &result);
  return result;
}

static napi_value SessionId(napi_env env, napi_callback_info) {
  napi_value result;
  napi_create_uint32(env, CurrentSession(), &result);
  return result;
}

static napi_value IsElevated(napi_env env, napi_callback_info) {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
    return ThrowWindowsError(env, "Could not inspect process privileges");
  }
  TOKEN_ELEVATION elevation{};
  DWORD length = 0;
  BOOL ok = GetTokenInformation(token, TokenElevation, &elevation, sizeof(elevation), &length);
  CloseHandle(token);
  if (!ok) return ThrowWindowsError(env, "Could not inspect process elevation");
  napi_value result;
  napi_get_boolean(env, elevation.TokenIsElevated != 0, &result);
  return result;
}

static napi_value IsProcessAlive(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  uint32_t pid = 0;
  if (count != 1 || napi_get_value_uint32(env, args[0], &pid) != napi_ok || pid == 0) {
    return ThrowWindowsError(env, "A process ID is required");
  }
  HANDLE process = OpenProcess(SYNCHRONIZE, FALSE, pid);
  bool alive = process && WaitForSingleObject(process, 0) == WAIT_TIMEOUT;
  if (process) CloseHandle(process);
  napi_value result;
  napi_get_boolean(env, alive, &result);
  return result;
}

static bool ReadString(napi_env env, napi_value value, std::wstring* result) {
  size_t length = 0;
  if (napi_get_value_string_utf16(env, value, nullptr, 0, &length) != napi_ok) return false;
  std::vector<char16_t> buffer(length + 1);
  if (napi_get_value_string_utf16(env, value, buffer.data(), buffer.size(), &length) != napi_ok) return false;
  result->assign(reinterpret_cast<const wchar_t*>(buffer.data()), length);
  return true;
}

static std::wstring QuoteArgument(const std::wstring& argument) {
  std::wstring quoted = L"\"";
  size_t slashes = 0;
  for (wchar_t ch : argument) {
    if (ch == L'\\') {
      ++slashes;
    } else {
      if (ch == L'"') quoted.append(slashes * 2 + 1, L'\\');
      else quoted.append(slashes, L'\\');
      slashes = 0;
      quoted += ch;
    }
  }
  quoted.append(slashes * 2, L'\\');
  return quoted + L'"';
}

static napi_value LaunchAsUser(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  std::wstring executable;
  bool isArray = false;
  if (count != 2 || !ReadString(env, args[0], &executable) ||
      napi_is_array(env, args[1], &isArray) != napi_ok || !isArray) {
    return ThrowWindowsError(env, "Executable and arguments are required");
  }
  std::wstring commandLine = QuoteArgument(executable);
  uint32_t length = 0;
  napi_get_array_length(env, args[1], &length);
  for (uint32_t index = 0; index < length; ++index) {
    napi_value value;
    std::wstring argument;
    napi_get_element(env, args[1], index, &value);
    if (!ReadString(env, value, &argument)) return ThrowWindowsError(env, "Invalid process argument");
    commandLine += L" " + QuoteArgument(argument);
  }

  HWND shell = GetShellWindow();
  DWORD shellPid = 0;
  if (shell) GetWindowThreadProcessId(shell, &shellPid);
  if (!shellPid) return ThrowWindowsError(env, "Could not find the standard user shell");
  HANDLE shellProcess = OpenProcess(PROCESS_CREATE_PROCESS | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, shellPid);
  if (!shellProcess) return ThrowLastError(env, "Could not open the standard user shell");
  HANDLE shellToken = nullptr;
  BOOL opened = OpenProcessToken(shellProcess, TOKEN_QUERY, &shellToken);
  if (!opened) {
    CloseHandle(shellProcess);
    return ThrowLastError(env, "Could not open the standard user shell token");
  }
  TOKEN_ELEVATION elevation{};
  DWORD returned = 0;
  BOOL elevationOk = GetTokenInformation(shellToken, TokenElevation, &elevation, sizeof(elevation), &returned);
  if (!elevationOk || elevation.TokenIsElevated) {
    CloseHandle(shellToken);
    CloseHandle(shellProcess);
    return ThrowWindowsError(env, "Shell token is not a standard user token");
  }
  CloseHandle(shellToken);

  SIZE_T attributeSize = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &attributeSize);
  std::vector<char> attributeBuffer(attributeSize);
  auto* attributes = reinterpret_cast<PPROC_THREAD_ATTRIBUTE_LIST>(attributeBuffer.data());
  if (!InitializeProcThreadAttributeList(attributes, 1, 0, &attributeSize)) {
    CloseHandle(shellProcess);
    return ThrowLastError(env, "Could not prepare standard user process attributes");
  }
  if (!UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_PARENT_PROCESS,
                                 &shellProcess, sizeof(shellProcess), nullptr, nullptr)) {
    DeleteProcThreadAttributeList(attributes);
    CloseHandle(shellProcess);
    return ThrowLastError(env, "Could not set the standard user process parent");
  }
  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(startup);
  startup.lpAttributeList = attributes;
  PROCESS_INFORMATION process{};
  BOOL created = CreateProcessW(executable.c_str(), commandLine.data(), nullptr, nullptr, FALSE,
                                EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW,
                                nullptr, nullptr, &startup.StartupInfo, &process);
  DeleteProcThreadAttributeList(attributes);
  CloseHandle(shellProcess);
  if (!created) return ThrowLastError(env, "Could not launch PoB Agent as standard user");
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  napi_value result;
  napi_create_uint32(env, process.dwProcessId, &result);
  return result;
}

static napi_value LaunchElevated(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  std::wstring executable;
  bool isArray = false;
  if (count != 2 || !ReadString(env, args[0], &executable) ||
      napi_is_array(env, args[1], &isArray) != napi_ok || !isArray) {
    return ThrowWindowsError(env, "Executable and arguments are required");
  }
  std::wstring parameters;
  uint32_t length = 0;
  napi_get_array_length(env, args[1], &length);
  for (uint32_t index = 0; index < length; ++index) {
    napi_value value;
    std::wstring argument;
    napi_get_element(env, args[1], index, &value);
    if (!ReadString(env, value, &argument)) return ThrowWindowsError(env, "Invalid process argument");
    if (!parameters.empty()) parameters += L" ";
    parameters += QuoteArgument(argument);
  }
  SHELLEXECUTEINFOW launch{};
  launch.cbSize = sizeof(launch);
  launch.fMask = SEE_MASK_NOCLOSEPROCESS;
  launch.lpVerb = L"runas";
  launch.lpFile = executable.c_str();
  launch.lpParameters = parameters.c_str();
  launch.nShow = SW_HIDE;
  if (!ShellExecuteExW(&launch)) return ThrowLastError(env, "Could not launch elevated PoB watcher");
  if (launch.hProcess) CloseHandle(launch.hProcess);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value ListPobs(napi_env env, napi_callback_info) {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) return ThrowWindowsError(env, "Could not enumerate processes");
  napi_value result;
  napi_create_array(env, &result);
  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);
  DWORD index = 0;
  const DWORD session = CurrentSession();
  if (Process32FirstW(snapshot, &entry)) {
    do {
      DWORD processSession = 0;
      if (_wcsicmp(entry.szExeFile, L"Path of Building.exe") == 0 &&
          ProcessIdToSessionId(entry.th32ProcessID, &processSession) && processSession == session) {
        napi_value pid;
        napi_create_uint32(env, entry.th32ProcessID, &pid);
        napi_set_element(env, result, index++, pid);
      }
    } while (Process32NextW(snapshot, &entry));
  }
  CloseHandle(snapshot);
  return result;
}

static void Deliver(napi_env env, napi_value callback, void*, void* data) {
  Event* event = static_cast<Event*>(data);
  if (env && callback) {
    napi_value object, type, pid, stage, undefined;
    napi_create_object(env, &object);
    napi_create_string_utf8(env, event->type, NAPI_AUTO_LENGTH, &type);
    napi_create_uint32(env, event->pid, &pid);
    napi_set_named_property(env, object, "type", type);
    napi_set_named_property(env, object, "pid", pid);
    if (!event->stage.empty()) {
      napi_create_string_utf8(env, event->stage.c_str(), NAPI_AUTO_LENGTH, &stage);
      napi_set_named_property(env, object, "stage", stage);
    }
    napi_get_undefined(env, &undefined);
    napi_call_function(env, undefined, callback, 1, &object, nullptr);
  }
  delete event;
}

static void Emit(Subscription* state, const char* type, DWORD pid = 0, std::string stage = "") {
  Event* event = new Event{type, pid, stage};
  if (napi_call_threadsafe_function(state->callback, event, napi_tsfn_nonblocking) != napi_ok) delete event;
}

static void WatchEvents(Subscription* state, bool starting) {
  const char* eventType = starting ? "start" : "stop";
  HRESULT initialized = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(initialized)) {
    Emit(state, "error", static_cast<DWORD>(initialized), std::string(eventType) + ":CoInitializeEx");
    napi_release_threadsafe_function(state->callback, napi_tsfn_release);
    return;
  }

  const wchar_t* query = starting ? L"SELECT * FROM Win32_ProcessStartTrace" : L"SELECT * FROM Win32_ProcessStopTrace";
  const DWORD session = CurrentSession();
  while (state->running) {
    IWbemLocator* locator = nullptr;
    IWbemServices* services = nullptr;
    IEnumWbemClassObject* events = nullptr;
    const char* stage = "CoCreateInstance";
    HRESULT status = CoCreateInstance(CLSID_WbemLocator, nullptr, CLSCTX_INPROC_SERVER,
                                      IID_IWbemLocator, reinterpret_cast<void**>(&locator));
    if (SUCCEEDED(status)) {
      stage = "ConnectServer";
      BSTR name = SysAllocString(L"ROOT\\CIMV2");
      status = locator->ConnectServer(name, nullptr, nullptr, nullptr, 0, nullptr, nullptr, &services);
      SysFreeString(name);
    }
    if (SUCCEEDED(status)) {
      stage = "CoSetProxyBlanket services";
      status = CoSetProxyBlanket(services, RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE, nullptr,
                                RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE, nullptr, EOAC_NONE);
    }
    if (SUCCEEDED(status)) {
      stage = "ExecNotificationQuery";
      BSTR language = SysAllocString(L"WQL");
      BSTR expression = SysAllocString(query);
      status = services->ExecNotificationQuery(language, expression,
                                               WBEM_FLAG_RETURN_IMMEDIATELY | WBEM_FLAG_FORWARD_ONLY,
                                               nullptr, &events);
      SysFreeString(expression);
      SysFreeString(language);
    }
    if (SUCCEEDED(status)) {
      stage = "CoSetProxyBlanket events";
      status = CoSetProxyBlanket(events, RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE, nullptr,
                                RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE, nullptr, EOAC_NONE);
    }
    if (SUCCEEDED(status)) {
      stage = "Next";
      Emit(state, "resync", 0, eventType);
      while (state->running) {
        IWbemClassObject* item = nullptr;
        ULONG count = 0;
        status = events->Next(1000, 1, &item, &count);
        if (status == WBEM_S_TIMEDOUT) continue;
        if (FAILED(status) || count == 0) break;
        VARIANT name, pid, processSession;
        VariantInit(&name);
        VariantInit(&pid);
        VariantInit(&processSession);
        HRESULT nameStatus = item->Get(L"ProcessName", 0, &name, nullptr, nullptr);
        HRESULT pidStatus = item->Get(L"ProcessID", 0, &pid, nullptr, nullptr);
        HRESULT sessionStatus = item->Get(L"SessionID", 0, &processSession, nullptr, nullptr);
        if (SUCCEEDED(nameStatus) && SUCCEEDED(pidStatus) && SUCCEEDED(sessionStatus) &&
            name.vt == VT_BSTR && _wcsicmp(name.bstrVal, L"Path of Building.exe") == 0 &&
            (pid.vt == VT_I4 || pid.vt == VT_UI4) &&
            (processSession.vt == VT_I4 || processSession.vt == VT_UI4) &&
            processSession.ulVal == session) {
          Emit(state, eventType, pid.ulVal);
        }
        VariantClear(&processSession);
        VariantClear(&pid);
        VariantClear(&name);
        item->Release();
      }
    }
    if (events) events->Release();
    if (services) services->Release();
    if (locator) locator->Release();
    if (state->running) {
      Emit(state, "error", static_cast<DWORD>(status), std::string(eventType) + ":" + stage);
      Sleep(1000);
    }
  }
  CoUninitialize();
  napi_release_threadsafe_function(state->callback, napi_tsfn_release);
}

static napi_value Subscribe(napi_env env, napi_callback_info info) {
  if (subscription) return ThrowWindowsError(env, "PoB watcher is already subscribed");
  size_t count = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  napi_valuetype type;
  if (count != 1 || napi_typeof(env, args[0], &type) != napi_ok || type != napi_function) {
    return ThrowWindowsError(env, "PoB watcher callback is required");
  }
  auto* state = new Subscription();
  napi_value name;
  napi_create_string_utf8(env, "PoB process events", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(env, args[0], nullptr, name, 0, 2, nullptr, nullptr,
                                      nullptr, Deliver, &state->callback) != napi_ok) {
    delete state;
    return ThrowWindowsError(env, "Could not start PoB process callbacks");
  }
  napi_unref_threadsafe_function(env, state->callback);
  subscription = state;
  state->started = std::thread(WatchEvents, state, true);
  state->stopped = std::thread(WatchEvents, state, false);
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value Stop(napi_env env, napi_callback_info) {
  if (subscription) {
    subscription->running = false;
    subscription->started.join();
    subscription->stopped.join();
    delete subscription;
    subscription = nullptr;
  }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"acquireLock", nullptr, AcquireLock, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"sessionId", nullptr, SessionId, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"isElevated", nullptr, IsElevated, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"isProcessAlive", nullptr, IsProcessAlive, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"launchAsUser", nullptr, LaunchAsUser, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"launchElevated", nullptr, LaunchElevated, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"listPobs", nullptr, ListPobs, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"subscribe", nullptr, Subscribe, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"stop", nullptr, Stop, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
