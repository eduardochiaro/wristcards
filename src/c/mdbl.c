#include <pebble.h>

int main(void) {
  Window *w = window_create();
  window_stack_push(w, true);

#ifdef PBL_DEBUG
  // Built with `pebble build --debug`: enable the xsbug JavaScript debugger.
  // Add kModdableCreationFlagLogInstrumentation here to log XS slot/chunk usage;
  // the stack/slot/chunk size fields are ignored by the firmware.
  ModdableCreationRecord cr = {
    .recordSize = sizeof(cr),
    .flags = kModdableCreationFlagDebug,
  };
  moddable_createMachine(&cr);
#else
  moddable_createMachine(NULL);
#endif

  window_destroy(w);
}
