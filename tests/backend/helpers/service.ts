type PublicService<Service> = { [Key in keyof Service]: Service[Key] };

/** Inject test doubles while retaining the service's public API and each mock's inferred type. */
export function withTestDependencies<Service extends object, Dependencies extends object>(
  service: Service,
  dependencies: Dependencies,
): PublicService<Service> & Dependencies {
  return Object.assign(service, dependencies);
}
