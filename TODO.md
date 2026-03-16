<!-- todo-tasks list: todo-tasks -->


## Features

- [ ] Test on another machine
  Need to test on Mac and Linux to verify cross-platform behavior
- [ ] Watch mode (auto-push on file change)
  Use fs.watch or chokidar to detect changes, debounce to avoid rapid syncs
- [ ] Preserve task ordering with position/move()
- [ ] Parse and sync URLs/links from markdown
- [ ] Use etag for conflict detection

## Performance

- [x] Parallelize API calls in sync
  Sequential create/update/delete is slow with many tasks, use Promise.all with concurrency limits
- [x] Cache Google Tasks API service instance
  getService() creates a new instance per call, could reuse
- [x] Paginate task lists
  getTaskLists only fetches first 100, no pagination like getTasks has

## Quality

- [x] Raise fuzzy match threshold
  0.6 is too low, "Fix login" matches "Fix signup" — consider 0.7+
- [x] Add sync.js tests
  Most complex module with zero test coverage
- [x] Add mapping.js tests
  Hash stability, load/save roundtrip, default shape
