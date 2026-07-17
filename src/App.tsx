import { useState } from 'react';
import { PropertyProvider } from './store/PropertyContext';
import { AuthProvider } from './store/AuthContext';
import { Layout } from './components/Layout';
import { PropertyDetails } from './components/PropertyDetails';
import { RoomsInventory } from './components/RoomsInventory';
import { KeysManagement } from './components/KeysManagement';
import { ConditionReportTab } from './components/ConditionReportTab';
import { ReportGenerator } from './components/ReportGenerator';
import { TakeoverForm } from './components/TakeoverForm';

function App() {
  const [activeTab, setActiveTab] = useState('property');

  const renderContent = () => {
    switch (activeTab) {
      case 'property':
        return <PropertyDetails />;
      case 'rooms':
        return <RoomsInventory />;
      case 'keys':
        return <KeysManagement />;
      case 'condition':
        return <ConditionReportTab />;
      case 'report':
        return <ReportGenerator />;
      case 'takeover':
        return <TakeoverForm />;
      default:
        return <PropertyDetails />;
    }
  };

  return (
    <AuthProvider>
      <PropertyProvider>
        <Layout activeTab={activeTab} onTabChange={setActiveTab}>
          {renderContent()}
        </Layout>
      </PropertyProvider>
    </AuthProvider>
  );
}

export default App;
