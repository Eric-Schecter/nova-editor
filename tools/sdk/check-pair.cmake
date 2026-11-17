# Configure-time pairing check; file SHA-256 verification is provided by sdk:verify.
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/.cache/nova/install-state.json")
  message(FATAL_ERROR "SDK install was interrupted. Run pnpm sdk:install to recover first.")
endif()
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/nova-sdk.lock.json" _nova_editor_lock)
string(JSON _nova_editor_version GET "${_nova_editor_lock}" version)
string(JSON _nova_editor_commit GET "${_nova_editor_lock}" sourceCommit)
foreach(_nova_editor_meta
  "${NOVA_SDK_ROOT}/share/nova-render/build-info.json"
  "${CMAKE_CURRENT_SOURCE_DIR}/deps/nova/web/generated/manifest.json")
  if(NOT EXISTS "${_nova_editor_meta}")
    message(FATAL_ERROR "Missing paired Nova SDK. Run pnpm sdk:install before configuring.")
  endif()
  file(READ "${_nova_editor_meta}" _nova_editor_info)
  string(JSON _nova_editor_info_version GET "${_nova_editor_info}" version)
  string(JSON _nova_editor_info_commit GET "${_nova_editor_info}" sourceCommit)
  string(JSON _nova_editor_info_dirty GET "${_nova_editor_info}" sourceDirty)
  if(NOT "${_nova_editor_info_version}" STREQUAL "${_nova_editor_version}" OR
     NOT "${_nova_editor_info_commit}" STREQUAL "${_nova_editor_commit}" OR
     _nova_editor_info_dirty)
    message(FATAL_ERROR "Native/Web Nova SDK differs from the lock. Run pnpm sdk:install; never mix package versions.")
  endif()
endforeach()

set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
 "${CMAKE_CURRENT_SOURCE_DIR}/nova-sdk.lock.json"
 "${NOVA_SDK_ROOT}/share/nova-render/build-info.json"
 "${CMAKE_CURRENT_SOURCE_DIR}/deps/nova/web/generated/manifest.json")
