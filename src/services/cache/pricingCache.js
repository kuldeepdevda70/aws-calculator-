const cache = new Map();

const DEFAULT_TTL = 60 * 60 * 1000; // 1 hour

function makeKey(serviceCode, region, filters = []) {
  const normalizedFilters = [...filters]
    .map((filter) => ({
      Type: filter.Type || "",
      Field: filter.Field || "",
      Value: filter.Value || "",
    }))
    .sort((a, b) =>
      `${a.Field}${a.Value}`.localeCompare(
        `${b.Field}${b.Value}`
      )
    );

  return JSON.stringify({
    serviceCode,
    region,
    filters: normalizedFilters,
  });
}

function get(key) {
  const item = cache.get(key);

  if (!item) {
    return null;
  }

  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }

  return item.value;
}

function set(key, value, ttl = DEFAULT_TTL) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttl,
  });

  return value;
}

function has(key) {
  return get(key) !== null;
}

function remove(key) {
  cache.delete(key);
}

function clear() {
  cache.clear();
}

function size() {
  return cache.size;
}

module.exports = {
  makeKey,
  get,
  set,
  has,
  remove,
  clear,
  size,
};