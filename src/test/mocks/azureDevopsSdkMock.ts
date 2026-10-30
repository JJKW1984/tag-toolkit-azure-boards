type ProjectInfo = { id: string; name: string } | null;

type WorkItemContributionHandler = Record<string, (...args: unknown[]) => unknown>;

let projectInfo: ProjectInfo = { id: "demo-project-id", name: "Demo Project" };
const registeredHandlers: WorkItemContributionHandler[] = [];

export const mockInit = jest.fn().mockResolvedValue(undefined);
export const mockNotifyLoadSucceeded = jest.fn();
export const mockGetAccessToken = jest.fn().mockResolvedValue("test-access-token");
export const mockGetHost = jest.fn(() => ({ name: "demo-org" }));
export const mockGetExtensionContext = jest.fn(() => ({
  id: "test-publisher.test-extension",
}));

export const mockProjectPageService = {
  getProject: jest.fn(async () => projectInfo),
};

export const mockExtensionDataManager = {
  getValue: jest.fn().mockResolvedValue(undefined),
  setValue: jest.fn().mockResolvedValue(undefined),
  createDocument: jest.fn(),
  updateDocument: jest.fn(),
  getDocument: jest.fn(),
  getDocuments: jest.fn(),
  deleteDocument: jest.fn(),
};

const documents = new Map<string, Record<string, unknown>>();

function resetDocuments(): void {
  documents.clear();
  const key = (collection: string, id: string) => `${collection}/${id}`;
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  mockExtensionDataManager.createDocument.mockReset().mockImplementation(async (collection: string, doc: Record<string, unknown>) => {
    const id = String(doc.id);
    if (documents.has(key(collection, id))) throw new Error("Document already exists");
    const saved = { ...copy(doc), __etag: 1 };
    documents.set(key(collection, id), saved);
    return copy(saved);
  });
  mockExtensionDataManager.updateDocument.mockReset().mockImplementation(async (collection: string, doc: Record<string, unknown>) => {
    const id = String(doc.id);
    const previous = documents.get(key(collection, id));
    if (!previous) throw new Error("Document not found");
    if (previous.__etag !== doc.__etag) throw new Error("Document conflict");
    const saved = { ...copy(doc), __etag: Number(doc.__etag) + 1 };
    documents.set(key(collection, id), saved);
    return copy(saved);
  });
  mockExtensionDataManager.getDocument.mockReset().mockImplementation(async (collection: string, id: string) => {
    const doc = documents.get(key(collection, id));
    if (!doc) throw new Error("Document not found");
    return copy(doc);
  });
  mockExtensionDataManager.getDocuments.mockReset().mockImplementation(async (collection: string) =>
    [...documents.entries()].filter(([id]) => id.startsWith(`${collection}/`)).map(([, doc]) => copy(doc))
  );
  mockExtensionDataManager.deleteDocument.mockReset().mockImplementation(async (collection: string, id: string) => {
    documents.delete(key(collection, id));
  });
}

export const mockExtensionDataService = {
  getExtensionDataManager: jest.fn(async () => mockExtensionDataManager),
};

export const mockGetService = jest.fn(async (serviceId: string) => {
  if (serviceId === "ms.vss-features.extension-data-service") return mockExtensionDataService;
  if (serviceId === "ms.vss-tfs-web.tfs-page-data-service") return mockProjectPageService;
  throw new Error(`mockGetService: unrecognised service ID "${serviceId}"`);
});

export const mockRegister = jest.fn(
  (_contributionId: string, handler: WorkItemContributionHandler) => {
    if (handler) {
      registeredHandlers.push(handler);
    }
  }
);

export function setMockProject(name: string | null): void {
  projectInfo = name ? { id: `${name}-id`, name } : null;
}

export function triggerRegisteredEvent(eventName: string, ...args: unknown[]): void {
  const handler = registeredHandlers[registeredHandlers.length - 1];
  if (!handler || typeof handler[eventName] !== "function") {
    throw new Error(`No registered handler for event: ${eventName}`);
  }
  handler[eventName](...args);
}

export function resetAzureDevopsSdkMock(): void {
  projectInfo = { id: "demo-project-id", name: "Demo Project" };
  resetDocuments();
  registeredHandlers.length = 0;

  mockInit.mockClear();
  mockInit.mockResolvedValue(undefined);

  mockNotifyLoadSucceeded.mockClear();

  mockGetAccessToken.mockClear();
  mockGetAccessToken.mockResolvedValue("test-access-token");

  mockGetHost.mockClear();
  mockGetHost.mockReturnValue({ name: "demo-org" });

  mockGetExtensionContext.mockClear();
  mockGetExtensionContext.mockReturnValue({ id: "test-publisher.test-extension" });

  mockProjectPageService.getProject.mockClear();
  mockProjectPageService.getProject.mockImplementation(async () => projectInfo);

  mockExtensionDataManager.getValue.mockClear();
  mockExtensionDataManager.getValue.mockResolvedValue(undefined);

  mockExtensionDataManager.setValue.mockClear();
  mockExtensionDataManager.setValue.mockResolvedValue(undefined);

  mockExtensionDataService.getExtensionDataManager.mockClear();
  mockExtensionDataService.getExtensionDataManager.mockResolvedValue(mockExtensionDataManager);

  mockGetService.mockClear();
  mockGetService.mockImplementation(async (serviceId: string) => {
    if (serviceId === "ms.vss-features.extension-data-service") return mockExtensionDataService;
    if (serviceId === "ms.vss-tfs-web.tfs-page-data-service") return mockProjectPageService;
    throw new Error(`mockGetService: unrecognised service ID "${serviceId}"`);
  });

  mockRegister.mockClear();
}

export function getRegisteredHandlerCount(): number {
  return registeredHandlers.length;
}

export const init = mockInit;
export const notifyLoadSucceeded = mockNotifyLoadSucceeded;
export const getAccessToken = mockGetAccessToken;
export const getHost = mockGetHost;
export const getExtensionContext = mockGetExtensionContext;
export const getService = mockGetService;
export const register = mockRegister;
export const getUser = () => ({ id: "user-id", displayName: "Test User", name: "tester" });
