import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Contact, ContactFormData } from '../../types';
import { shortenAddress } from '../../utils/addressValidation';

const STORAGE_KEY = '@warthog:addressbook:contacts';

type SortOption = 'name' | 'recent' | 'frequency' | 'favorites';

export const useAddressBook = () => {
  // Hook implementation...
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('name');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load contacts from storage
  const loadContacts = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: Contact[] = JSON.parse(stored);
        const withDates = parsed.map(c => ({
          ...c,
          lastUsed: c.lastUsed ? new Date(c.lastUsed) : undefined,
        }));
        setContacts(withDates);
      } else {
        setContacts([]);
      }
    } catch (err: any) {
      console.error('Failed to load address book:', err);
      setError('Failed to load contacts');
      setContacts([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Save contacts to storage
  const saveContacts = useCallback(async (newContacts: Contact[]) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newContacts));
    } catch (err: any) {
      console.error('Failed to save address book:', err);
      setError('Failed to save contacts');
      throw err;
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  const refreshContacts = useCallback(async () => {
    await loadContacts();
  }, [loadContacts]);

  // Filter + sort contacts
  const filteredContacts = useMemo(() => {
    let result = [...contacts];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.address.toLowerCase().includes(q) ||
        (c.notes && c.notes.toLowerCase().includes(q))
      );
    }

    switch (sortBy) {
      case 'name':
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'recent':
        result.sort((a, b) => {
          if (!a.lastUsed && !b.lastUsed) return 0;
          if (!a.lastUsed) return 1;
          if (!b.lastUsed) return -1;
          return b.lastUsed.getTime() - a.lastUsed.getTime();
        });
        break;
      case 'frequency':
        result.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
        break;
      case 'favorites':
        result.sort((a, b) => (a.isFavorite === b.isFavorite ? 0 : a.isFavorite ? -1 : 1));
        break;
    }

    return result;
  }, [contacts, searchQuery, sortBy]);

  const addContact = useCallback(async (formData: ContactFormData) => {
    try {
      setIsLoading(true);
      setError(null);

      const newContact: Contact = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        name: formData.name.trim(),
        address: formData.address.trim(),
        notes: formData.notes?.trim() || '',
        isFavorite: formData.isFavorite || false,
        usageCount: 0,
        lastUsed: undefined,
        createdAt: new Date(),
      };

      const updated = [...contacts, newContact];
      await saveContacts(updated);
      setContacts(updated);
    } catch (err: any) {
      setError('Failed to add contact');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [contacts, saveContacts]);

  const updateContact = useCallback(async (id: string, formData: ContactFormData) => {
    try {
      setIsLoading(true);
      setError(null);

      const updated = contacts.map(contact =>
        contact.id === id
          ? {
              ...contact,
              name: formData.name.trim(),
              address: formData.address.trim(),
              notes: formData.notes?.trim() || '',
              isFavorite: formData.isFavorite || false,
              updatedAt: new Date(),
            }
          : contact
      );

      setContacts(updated);
      await saveContacts(updated);
    } catch (err: any) {
      setError('Failed to update contact');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [contacts, saveContacts]);

  const deleteContact = useCallback(async (id: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const updated = contacts.filter(c => c.id !== id);
      setContacts(updated);
      await saveContacts(updated);
    } catch (err: any) {
      setError('Failed to delete contact');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [contacts, saveContacts]);

  const toggleFavorite = useCallback(async (id: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const updated = contacts.map(contact =>
        contact.id === id
          ? { ...contact, isFavorite: !contact.isFavorite }
          : contact
      );

      setContacts(updated);
      await saveContacts(updated);
    } catch (err: any) {
      setError('Failed to toggle favorite');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [contacts, saveContacts]);

  const importContacts = useCallback(async (data: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const imported: Contact[] = JSON.parse(data);
      const merged = [...contacts, ...imported.filter(i => !contacts.some(c => c.address === i.address))];
      setContacts(merged);
      await saveContacts(merged);
    } catch (err: any) {
      setError('Failed to import contacts');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [contacts, saveContacts]);

  // ====================== NEW: FAST ADDRESS LOOKUP (O(1)) ======================
  const contactMap = useMemo(() => {
    const map = new Map<string, Contact>();
    contacts.forEach(contact => {
      map.set(contact.address.toLowerCase().trim(), contact);
    });
    return map;
  }, [contacts]);

  const getContactByAddress = useCallback((address?: string): Contact | undefined => {
    if (!address) return undefined;
    return contactMap.get(address.toLowerCase().trim());
  }, [contactMap]);

  const getDisplayName = useCallback((address: string): string => {
    const contact = getContactByAddress(address);
    return contact ? contact.name : shortenAddress(address);
  }, [getContactByAddress]);

  const recordAddressUsage = useCallback(async (address: string) => {
    const contact = getContactByAddress(address);
    if (!contact) return false;

    const updated = contacts.map(c =>
      c.id === contact.id
        ? {
            ...c,
            usageCount: (c.usageCount || 0) + 1,
            lastUsed: new Date(),
          }
        : c
    );

    setContacts(updated);
    await saveContacts(updated);
    return true;
  }, [contacts, getContactByAddress, saveContacts]);
  // =============================================================================

  return {
    contacts,
    filteredContacts,
    isLoading,
    error,
    searchQuery,
    sortBy,
    setSearchQuery: (q: string) => setSearchQuery(q),
    setSortBy: (s: SortOption) => setSortBy(s),
    addContact,
    updateContact,
    deleteContact,
    toggleFavorite,
    refreshContacts,
    importContacts,

    // ← NEW PUBLIC API
    getContactByAddress,
    getDisplayName,
    recordAddressUsage,
  };
};

// The rest of the file (AddressBookModal component) remains 100% unchanged
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { colors, spacing, typography } from '../../theme';
import { Button } from '../Button';
import { ContactList } from './ContactList';
import { ContactForm } from './ContactForm';

type AddressBookModalMode = 'select' | 'manage';
type ViewMode = 'list' | 'form';

interface AddressBookModalProps {
  visible: boolean;
  mode?: AddressBookModalMode;
  onClose: () => void;
  onSelectContact?: (contact: Contact) => void;
  preselectedAddress?: string;
  allowAddNew?: boolean;
  title?: string;
}

export const AddressBookModal: React.FC<AddressBookModalProps> = ({
  visible,
  mode = 'select',
  onClose,
  onSelectContact,
  preselectedAddress,
  allowAddNew = true,
  title,
}) => {
  const insets = useSafeAreaInsets();

  const containerStyle = { flex: 1, backgroundColor: colors.background, marginBottom: insets.bottom };

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingContact, setEditingContact] = useState<Contact | undefined>();
  const [searchQuery, setSearchQuery] = useState('');

  const {
    contacts,
    filteredContacts,
    isLoading,
    error,
    addContact,
    updateContact,
    deleteContact,
    refreshContacts,
    setSearchQuery: setHookSearchQuery,
  } = useAddressBook();

  React.useEffect(() => {
    if (visible) {
      refreshContacts();
    }
  }, [visible, refreshContacts]);

  React.useEffect(() => {
    setHookSearchQuery(searchQuery);
  }, [searchQuery, setHookSearchQuery]);

  const handleSelectContact = (contact: Contact) => {
    if (mode === 'select' && onSelectContact) {
      onSelectContact(contact);
      onClose();
    }
  };

  const handleAddContact = () => {
    setEditingContact(undefined);
    setViewMode('form');
  };

  const handleEditContact = (contact: Contact) => {
    setEditingContact(contact);
    setViewMode('form');
  };

  const handleSaveContact = async (formData: any) => {
    try {
      if (editingContact) {
        await updateContact(editingContact.id, formData);
      } else {
        await addContact(formData);
      }
      setViewMode('list');
      setEditingContact(undefined);
    } catch (error) {
      throw error;
    }
  };

  const handleCancelForm = () => {
    setViewMode('list');
    setEditingContact(undefined);
  };

  const handleDeleteContact = async (contact: Contact) => {
    await deleteContact(contact.id);
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.title}>
        {title || (mode === 'select' ? 'Select Contact' : 'Address Book')}
      </Text>

      <TouchableOpacity
        style={styles.closeButton}
        onPress={onClose}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.closeIcon}>✕</Text>
      </TouchableOpacity>
    </View>
  );

  const renderToolbar = () => {
    if (viewMode === 'form') return null;

    return (
      <View style={styles.toolbar}>
        <View style={styles.toolbarLeft}>
          {allowAddNew && (
            <Button
              title="+ Add Contact"
              variant="outline"
              size="small"
              onPress={handleAddContact}
            />
          )}
        </View>

        <View style={styles.toolbarRight}>
          <Text style={styles.contactCount}>
            {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>
    );
  };

  const renderContent = () => {
    if (viewMode === 'form') {
      return (
        <ContactForm
          mode={editingContact ? 'edit' : 'create'}
          contact={editingContact}
          onSave={handleSaveContact}
          onCancel={handleCancelForm}
          isLoading={isLoading}
          initialAddress={preselectedAddress}
        />
      );
    }

    return (
      <ContactList
        contacts={filteredContacts}
        mode={mode}
        onSelectContact={handleSelectContact}
        onEditContact={mode === 'manage' ? handleEditContact : undefined}
        onDeleteContact={mode === 'manage' ? handleDeleteContact : undefined}
        onRefresh={refreshContacts}
        emptyMessage="No contacts yet. Tap 'Add Contact' to get started."
        showSearch={contacts.length > 5}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />
    );
  };

  const renderError = () => {
    if (!error) return null;

    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <Button
          title="Retry"
          variant="outline"
          size="small"
          onPress={refreshContacts}
        />
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={containerStyle}>
        {renderHeader()}
        {renderToolbar()}
        {renderError()}
        {renderContent()}
      </View>
    </Modal>
  );
};

const { height: screenHeight } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },

  title: {
    color: colors.textPrimary,
    fontSize: typography.h3,
    fontWeight: typography.bold,
  },

  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },

  closeIcon: {
    color: colors.textPrimary,
    fontSize: typography.h4,
    fontWeight: typography.bold,
  },

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.surfaceLight,
  },

  toolbarLeft: {
    flex: 1,
  },

  toolbarRight: {
    flex: 1,
    alignItems: 'flex-end',
  },

  contactCount: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },

  errorContainer: {
    margin: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.error,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  errorText: {
    color: colors.surface,
    fontSize: typography.bodySm,
    flex: 1,
    marginRight: spacing.md,
  },
});

export default AddressBookModal;
