#include <BRepBndLib.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <Bnd_Box.hxx>
#include <RWGltf_CafWriter.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <Standard_Failure.hxx>
#include <TColStd_IndexedDataMapOfStringString.hxx>
#include <TDocStd_Document.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <algorithm>
#include <iostream>
#include <stdexcept>

int main(int argc, char** argv)
{
    try
    {
        if (argc != 3)
            throw std::runtime_error("Usage: nova_step input.step output.glb");
        auto application = XCAFApp_Application::GetApplication();
        Handle(TDocStd_Document) doc;
        application->NewDocument("BinXCAF", doc);
        STEPCAFControl_Reader reader;
        if (reader.ReadFile(argv[1]) != IFSelect_RetDone || !reader.Transfer(doc))
            throw std::runtime_error("Cannot read STEP document");
        const auto shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
        TDF_LabelSequence roots;
        shapes->GetFreeShapes(roots);
        for (Standard_Integer i = 1; i <= roots.Length(); ++i)
        {
            const auto shape = shapes->GetShape(roots.Value(i));
            Bnd_Box bounds;
            BRepBndLib::Add(shape, bounds, false);
            if (bounds.IsVoid() || bounds.IsOpen())
                continue;
            Standard_Real x0, y0, z0, x1, y1, z1;
            bounds.Get(x0, y0, z0, x1, y1, z1);
            const double tolerance = std::max(0.0001, ((x1-x0)+(y1-y0)+(z1-z0)) / 3000.0);
            BRepMesh_IncrementalMesh mesher(shape, tolerance, false, 0.35);
        }
        RWGltf_CafWriter writer(argv[2], true);
        writer.ChangeCoordinateSystemConverter().SetInputLengthUnit(0.001);
        writer.ChangeCoordinateSystemConverter().SetInputCoordinateSystem(RWMesh_CoordinateSystem_Zup);
        writer.SetMergeFaces(true);
        TColStd_IndexedDataMapOfStringString metadata;
        if (!writer.Perform(doc, metadata, Message_ProgressRange()))
            throw std::runtime_error("Cannot write tessellated STEP model");
        return 0;
    }
    catch (const Standard_Failure& error)
    {
        std::cerr << error.GetMessageString() << '\n';
        return 1;
    }
    catch (const std::exception& error)
    {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
