export const CommonServiceIds = {
  ProjectPageService: "ms.vss-tfs-web.tfs-page-data-service",
  ExtensionDataService: "ms.vss-features.extension-data-service",
};

export interface IProjectPageService {
  getProject(): Promise<{ id: string; name: string } | null>;
}

export interface IExtensionDataManager {
  getValue<T>(key: string, documentId?: string): Promise<T>;
  setValue<T>(key: string, value: T, documentId?: string): Promise<T>;
  createDocument(collection: string, doc: unknown): Promise<unknown>;
  updateDocument(collection: string, doc: unknown): Promise<unknown>;
  getDocument(collection: string, id: string): Promise<unknown>;
  getDocuments(collection: string): Promise<unknown[]>;
  deleteDocument(collection: string, id: string): Promise<void>;
}

export interface IExtensionDataService {
  getExtensionDataManager(extensionId: string, accessToken: string): Promise<IExtensionDataManager>;
}
