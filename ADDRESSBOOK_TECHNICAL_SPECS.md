# 🔧 Address Book - Technical Specifications

## 📋 Overview

This document provides detailed technical specifications for implementing the Address Book feature in the Warthog Wallet. It includes data structures, API contracts, security requirements, and integration patterns.

---

## 🗄️ Data Models & Storage

### Contact Data Structure
```typescript
interface Contact {
  id: string;                    // UUID v4 for unique identification
  name: string;                  // User-friendly display name (1-50 chars)
  address: string;               // Warthog wallet address (42 chars, 0x prefixed)
  notes?: string;                // Optional notes (max 200 chars)
  createdAt: Date;               // ISO timestamp of creation
  lastUsed?: Date;               // ISO timestamp of last transaction use
  isFavorite?: boolean;          // Star/pin status for quick access
  usageCount: number;            // Incrementing counter for frequency sorting
  tags?: string[];               // Optional categorization tags
}

// Form data for creating/editing contacts
interface ContactFormData {
  name: string;
  address: string;
  notes?: string;
  isFavorite?: boolean;
}

// Search and filter state
interface AddressBookState {
  contacts: Contact[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  sortBy: 'name' | 'recent' | 'frequency' | 'favorites';
  filterTags: string[];
}
```

### Storage Schema
```typescript
// SecureStore key structure
const STORAGE_KEYS = {
  CONTACTS: 'warthog_contacts_v1',          // Main contact storage
  METADATA: 'warthog_contacts_meta_v1',     // Version and migration info
  BACKUP: 'warthog_contacts_backup_v1',     // Last backup timestamp
} as const;

// Stored data format (encrypted)
interface ContactStorageData {
  version: '1.0.0';                         // Schema version for migrations
  contacts: Contact[];                      // Array of all contacts
  createdAt: Date;                         // First time contacts were saved
  updatedAt: Date;                         // Last modification timestamp
  checksum: string;                        // Data integrity verification
}
```

---

## 🔐 Security Implementation

### Encryption Strategy
```typescript
// Contact data encryption using expo-secure-store
import * as SecureStore from 'expo-secure-store';

export class SecureContactStorage {
  private static readonly ENCRYPTION_OPTIONS = {
    keychainService: 'warthog-wallet-contacts',
    sharedPreferencesName: 'warthog-contacts',
    encrypt: true,
    requireAuthentication: false,  // Allow background access
    accessGroup: undefined,
  };

  // All contact data is encrypted before storage
  static async secureSet(key: string, value: string): Promise<void> {
    return SecureStore.setItemAsync(key, value, this.ENCRYPTION_OPTIONS);
  }

  static async secureGet(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key, this.ENCRYPTION_OPTIONS);
  }
}
```

### Address Validation
```typescript
// Warthog address validation
export const validateWarthogAddress = (address: string): ValidationResult => {
  // 1. Length check (42 characters)
  if (address.length !== 42) {
    return { isValid: false, error: 'Address must be 42 characters long' };
  }

  // 2. Format check (starts with 0x)
  if (!address.startsWith('0x')) {
    return { isValid: false, error: 'Address must start with 0x' };
  }

  // 3. Hex character validation
  const hexPattern = /^0x[0-9a-fA-F]{40}$/;
  if (!hexPattern.test(address)) {
    return { isValid: false, error: 'Address contains invalid characters' };
  }

  // 4. Checksum validation (EIP-55)
  try {
    const checksumAddress = ethers.utils.getAddress(address);
    if (checksumAddress !== address && address !== address.toLowerCase()) {
      return { isValid: false, error: 'Invalid address checksum' };
    }
  } catch (error) {
    return { isValid: false, error: 'Invalid address format' };
  }

  return { isValid: true };
};
```

---

## 🔄 API Contracts

### ContactStorage Interface
```typescript
export interface IContactStorage {
  // Core CRUD operations
  getContacts(): Promise<Contact[]>;
  getContact(id: string): Promise<Contact | null>;
  saveContact(contactData: ContactFormData): Promise<Contact>;
  updateContact(id: string, updates: Partial<Contact>): Promise<Contact>;
  deleteContact(id: string): Promise<boolean>;

  // Search and query operations
  findByAddress(address: string): Promise<Contact | null>;
  findByName(name: string): Promise<Contact[]>;
  searchContacts(query: string): Promise<Contact[]>;

  // Utility operations
  incrementUsage(id: string): Promise<void>;
  getRecentContacts(limit?: number): Promise<Contact[]>;
  getFavoriteContacts(): Promise<Contact[]>;

  // Data management
  exportContacts(): Promise<string>;
  importContacts(data: string): Promise<Contact[]>;
  clearAllContacts(): Promise<void>;
  getStorageStats(): Promise<ContactStorageStats>;
}

interface ContactStorageStats {
  totalContacts: number;
  favoriteCount: number;
  storageSize: number;
  lastBackup?: Date;
}
```

### Hook Interface
```typescript
export interface IUseAddressBook {
  // State
  contacts: Contact[];
  filteredContacts: Contact[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  sortBy: SortOption;

  // Actions
  loadContacts: () => Promise<void>;
  addContact: (data: ContactFormData) => Promise<Contact>;
  updateContact: (id: string, updates: Partial<Contact>) => Promise<Contact>;
  deleteContact: (id: string) => Promise<boolean>;
  
  // Search and filter
  setSearchQuery: (query: string) => void;
  setSortBy: (sort: SortOption) => void;
  clearSearch: () => void;

  // Utility
  refreshContacts: () => Promise<void>;
  getContactByAddress: (address: string) => Contact | null;
}
```

---

## 🎨 Component Specifications

### ContactItem Component
```typescript
interface ContactItemProps {
  contact: Contact;
  mode: 'display' | 'select' | 'manage';
  onSelect?: (contact: Contact) => void;
  onEdit?: (contact: Contact) => void;
  onDelete?: (contact: Contact) => void;
  onToggleFavorite?: (contact: Contact) => void;
  showActions?: boolean;
  showAvatar?: boolean;
}

// Component features:
// - Avatar generation (colored circle with initials)
// - Address truncation with full address on tap
// - Copy to clipboard functionality
// - Swipe actions for edit/delete/favorite
// - Accessibility support
```

### ContactForm Component
```typescript
interface ContactFormProps {
  mode: 'create' | 'edit';
  contact?: Contact;
  onSave: (data: ContactFormData) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  initialAddress?: string;  // Pre-populate from transaction
}

// Form validation rules:
const VALIDATION_RULES = {
  name: {
    required: true,
    minLength: 1,
    maxLength: 50,
    pattern: /^[a-zA-Z0-9\s\-_.,]+$/,  // Alphanumeric + common chars
  },
  address: {
    required: true,
    validator: validateWarthogAddress,
  },
  notes: {
    required: false,
    maxLength: 200,
  },
};
```

### AddressBookModal Component
```typescript
interface AddressBookModalProps {
  visible: boolean;
  mode: 'select' | 'manage';
  onClose: () => void;
  onSelectContact?: (contact: Contact) => void;
  preselectedAddress?: string;      // Highlight if contact exists
  allowAddNew?: boolean;
  title?: string;
}

// Modal features:
// - Animated slide-up presentation
// - Search bar with real-time filtering
// - Tab switching: All | Favorites | Recent
// - Empty state with call-to-action
// - Pull-to-refresh functionality
```

---

## 🔌 Integration Points

### SendTransaction Component Integration
```typescript
// Modifications to existing SendTransaction.tsx
interface SendTransactionState {
  // Existing state...
  selectedContact: Contact | null;
  showAddressBook: boolean;
  showSaveContact: boolean;
}

// New methods to add:
const handleContactSelect = (contact: Contact) => {
  setRecipientAddress(contact.address);
  setSelectedContact(contact);
  ContactStorage.incrementUsage(contact.id);
  setShowAddressBook(false);
};

const handleSaveNewContact = async (address: string) => {
  const contactData = {
    name: `Contact ${Date.now()}`, // Placeholder name
    address: address,
  };
  await addressBook.addContact(contactData);
};
```

### TransactionHistory Integration
```typescript
// Enhance transaction display with contact names
interface EnhancedTransaction extends Transaction {
  contactName?: string;
  contactAvatar?: string;
  isKnownAddress: boolean;
}

const useTransactionEnhancement = () => {
  const { getContactByAddress } = useAddressBook();
  
  const enhanceTransactions = useCallback((transactions: Transaction[]) => {
    return transactions.map(tx => {
      const contact = getContactByAddress(tx.toAddress || tx.fromAddress);
      return {
        ...tx,
        contactName: contact?.name,
        contactAvatar: contact ? generateAvatar(contact.name) : null,
        isKnownAddress: !!contact,
      };
    });
  }, [getContactByAddress]);
  
  return { enhanceTransactions };
};
```

---

## 🎯 Performance Requirements

### Loading Performance
- Contact list should render within 100ms for up to 1000 contacts
- Search results should update within 50ms of user input
- Modal animations should maintain 60fps

### Memory Management
- Use FlatList virtualization for contact lists >50 items
- Implement contact avatar caching
- Debounce search input (300ms delay)
- Lazy load contact details on demand

### Storage Performance
```typescript
// Optimize storage operations
class OptimizedContactStorage {
  private cache: Map<string, Contact> = new Map();
  private lastCacheUpdate: Date | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  async getContacts(): Promise<Contact[]> {
    // Check cache first
    if (this.isCacheValid()) {
      return Array.from(this.cache.values());
    }
    
    // Load from storage and update cache
    const contacts = await this.loadFromStorage();
    this.updateCache(contacts);
    return contacts;
  }

  private isCacheValid(): boolean {
    return this.lastCacheUpdate && 
           (Date.now() - this.lastCacheUpdate.getTime()) < this.CACHE_TTL;
  }
}
```

---

## 🧪 Testing Strategy

### Unit Test Coverage
```typescript
// ContactStorage tests
describe('ContactStorage', () => {
  test('should save and retrieve contacts');
  test('should handle duplicate addresses');
  test('should validate address format');
  test('should handle storage errors gracefully');
  test('should maintain data integrity');
});

// useAddressBook hook tests
describe('useAddressBook', () => {
  test('should load contacts on mount');
  test('should filter contacts by search query');
  test('should sort contacts by different criteria');
  test('should handle CRUD operations');
});
```

### Integration Test Scenarios
```typescript
// End-to-end user flows
describe('Address Book Integration', () => {
  test('User can add contact and use in transaction');
  test('Contact appears in transaction history');
  test('Search finds contacts by name and address');
  test('Data persists after app restart');
  test('Import/export works correctly');
});
```

### Performance Testing
```typescript
// Performance benchmarks
describe('Performance Tests', () => {
  test('Should render 1000 contacts within 100ms');
  test('Should search 1000 contacts within 50ms');
  test('Should save contact within 100ms');
  test('Modal animation should maintain 60fps');
});
```

---

## 📱 Platform Considerations

### iOS Specific
- Use KeychainService for secure storage
- Support dynamic type sizing
- Implement haptic feedback for actions
- Support Voice Over accessibility

### Android Specific
- Use EncryptedSharedPreferences fallback
- Support system back button in modals
- Implement material design ripple effects
- Support TalkBack accessibility

### Cross-Platform
- Consistent spacing using theme.ts
- Responsive design for different screen sizes
- Dark mode support using theme colors
- Internationalization ready (i18n keys)

---

## 🚀 Migration & Versioning

### Data Migration Strategy
```typescript
interface MigrationPlan {
  fromVersion: string;
  toVersion: string;
  migrationSteps: MigrationStep[];
}

const MIGRATIONS: MigrationPlan[] = [
  {
    fromVersion: '1.0.0',
    toVersion: '1.1.0',
    migrationSteps: [
      { action: 'addField', field: 'tags', defaultValue: [] },
      { action: 'addField', field: 'isFavorite', defaultValue: false },
    ],
  },
];
```

### Rollback Strategy
- Always backup existing data before migration
- Implement version detection and rollback capability
- Provide export functionality before major updates

---

**Implementation Ready!** This technical specification provides all the details needed to implement a robust, secure, and performant Address Book feature. Refer to `ADDRESSBOOK_ROADMAP.md` for the step-by-step implementation guide.
